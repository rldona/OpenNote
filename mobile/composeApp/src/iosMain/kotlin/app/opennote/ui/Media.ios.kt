package app.opennote.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asSkiaBitmap
import androidx.compose.ui.graphics.toComposeImageBitmap
import kotlin.coroutines.resume
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.sqrt
import kotlinx.cinterop.BetaInteropApi
import kotlinx.cinterop.ExperimentalForeignApi
import kotlinx.cinterop.ObjCSignatureOverride
import kotlinx.cinterop.useContents
import kotlinx.coroutines.suspendCancellableCoroutine
import org.jetbrains.skia.EncodedImageFormat
import org.jetbrains.skia.Image
import org.jetbrains.skia.Rect
import org.jetbrains.skia.Surface
import platform.AVFAudio.AVAudioQualityHigh
import platform.AVFAudio.AVAudioRecorder
import platform.AVFAudio.AVAudioSession
import platform.AVFAudio.AVAudioSessionCategoryOptionDefaultToSpeaker
import platform.AVFAudio.AVAudioSessionCategoryPlayAndRecord
import platform.AVFAudio.AVEncoderAudioQualityKey
import platform.AVFAudio.AVFormatIDKey
import platform.AVFAudio.AVNumberOfChannelsKey
import platform.AVFAudio.AVSampleRateKey
import platform.AVFAudio.setActive
import platform.CoreAudioTypes.kAudioFormatMPEG4AAC
import platform.CoreGraphics.CGRectMake
import platform.CoreGraphics.CGSizeMake
import platform.Foundation.NSBundle
import platform.Foundation.NSData
import platform.Foundation.NSDate
import platform.Foundation.NSFileManager
import platform.Foundation.NSTemporaryDirectory
import platform.Foundation.NSURL
import platform.Foundation.dataWithContentsOfURL
import platform.Foundation.timeIntervalSince1970
import platform.UIKit.UIApplication
import platform.UIKit.UIDocumentPickerDelegateProtocol
import platform.UIKit.UIDocumentPickerViewController
import platform.UIKit.UIGraphicsImageRenderer
import platform.UIKit.UIGraphicsImageRendererFormat
import platform.UIKit.UIImage
import platform.UIKit.UIImageJPEGRepresentation
import platform.UIKit.UIImagePickerController
import platform.UIKit.UIImagePickerControllerDelegateProtocol
import platform.UIKit.UIImagePickerControllerOriginalImage
import platform.UIKit.UIImagePickerControllerSourceType
import platform.UIKit.UINavigationControllerDelegateProtocol
import platform.UIKit.UIViewController
import platform.UniformTypeIdentifiers.UTType
import platform.UniformTypeIdentifiers.UTTypeItem
import platform.VisionKit.VNDocumentCameraScan
import platform.VisionKit.VNDocumentCameraViewController
import platform.VisionKit.VNDocumentCameraViewControllerDelegateProtocol
import platform.darwin.NSObject

/** The view controller on top, to present the system's screens from. */
@Suppress("DEPRECATION")
private fun topController(): UIViewController? {
    var vc = UIApplication.sharedApplication.keyWindow?.rootViewController
    while (vc?.presentedViewController != null) vc = vc.presentedViewController
    return vc
}

private fun stamp() = NSDate().timeIntervalSince1970.toLong()

/** Photos at most 2560 px on the longer side, drawn upright, as JPEG at 85 %. */
@OptIn(ExperimentalForeignApi::class)
private fun jpeg(image: UIImage): ByteArray? {
    val (w, h) = image.size.useContents { width to height }
    val k = min(1.0, 2560.0 / max(w, h))
    val format = UIGraphicsImageRendererFormat().apply { scale = 1.0 }
    val upright = UIGraphicsImageRenderer(size = CGSizeMake(w * k, h * k), format = format).imageWithActions { _ ->
        image.drawInRect(CGRectMake(0.0, 0.0, w * k, h * k))
    }
    return UIImageJPEGRepresentation(upright, 0.85)?.toByteArray()
}

// UIKit keeps delegates as weak references: the one in use is held here.
private var activeDelegate: NSObject? = null

private class PhotoDelegate(val done: (SharedFile?) -> Unit) : NSObject(), UIImagePickerControllerDelegateProtocol, UINavigationControllerDelegateProtocol {
    override fun imagePickerController(picker: UIImagePickerController, didFinishPickingMediaWithInfo: Map<Any?, *>) {
        val image = didFinishPickingMediaWithInfo[UIImagePickerControllerOriginalImage] as? UIImage
        picker.dismissViewControllerAnimated(true, null)
        activeDelegate = null
        done(image?.let(::jpeg)?.let { SharedFile("photo-${stamp()}.jpg", "image/jpeg", it) })
    }

    override fun imagePickerControllerDidCancel(picker: UIImagePickerController) {
        picker.dismissViewControllerAnimated(true, null)
        activeDelegate = null
        done(null)
    }
}

private class FilesDelegate(val done: (List<SharedFile>) -> Unit) : NSObject(), UIDocumentPickerDelegateProtocol {
    override fun documentPicker(controller: UIDocumentPickerViewController, didPickDocumentsAtURLs: List<*>) {
        activeDelegate = null
        done(didPickDocumentsAtURLs.mapNotNull { (it as? NSURL)?.let(::readFile) })
    }

    override fun documentPickerWasCancelled(controller: UIDocumentPickerViewController) {
        activeDelegate = null
        done(emptyList())
    }
}

private fun readFile(url: NSURL): SharedFile? {
    val data = NSData.dataWithContentsOfURL(url) ?: return null
    val name = url.lastPathComponent ?: "file"
    val mime = url.pathExtension?.let { UTType.typeWithFilenameExtension(it)?.preferredMIMEType } ?: "application/octet-stream"
    return SharedFile(name, mime, data.toByteArray())
}

private class ScanDelegate(val done: (List<SharedFile>) -> Unit) : NSObject(), VNDocumentCameraViewControllerDelegateProtocol {
    override fun documentCameraViewController(controller: VNDocumentCameraViewController, didFinishWithScan: VNDocumentCameraScan) {
        val t = stamp()
        val pages = (0uL until didFinishWithScan.pageCount).mapNotNull { i ->
            jpeg(didFinishWithScan.imageOfPageAtIndex(i))?.let { SharedFile("scan-$t-${i + 1uL}.jpg", "image/jpeg", it) }
        }
        controller.dismissViewControllerAnimated(true, null)
        activeDelegate = null
        done(pages)
    }

    override fun documentCameraViewControllerDidCancel(controller: VNDocumentCameraViewController) {
        controller.dismissViewControllerAnimated(true, null)
        activeDelegate = null
        done(emptyList())
    }

    @ObjCSignatureOverride
    override fun documentCameraViewController(controller: VNDocumentCameraViewController, didFailWithError: platform.Foundation.NSError) {
        controller.dismissViewControllerAnimated(true, null)
        activeDelegate = null
        done(emptyList())
    }
}

@Composable
actual fun rememberCapture(): Capture = remember {
    object : Capture {
        override val canScan: Boolean get() = VNDocumentCameraViewController.isSupported()

        override fun photo(onResult: (SharedFile?) -> Unit) {
            val picker = UIImagePickerController()
            // The simulator has no camera: the photo library instead.
            val camera = UIImagePickerController.isSourceTypeAvailable(UIImagePickerControllerSourceType.UIImagePickerControllerSourceTypeCamera)
            picker.sourceType = if (camera) UIImagePickerControllerSourceType.UIImagePickerControllerSourceTypeCamera
            else UIImagePickerControllerSourceType.UIImagePickerControllerSourceTypePhotoLibrary
            val d = PhotoDelegate(onResult)
            activeDelegate = d
            picker.delegate = d
            topController()?.presentViewController(picker, true, null) ?: onResult(null)
        }

        override fun scan(onResult: (List<SharedFile>) -> Unit) {
            if (!VNDocumentCameraViewController.isSupported()) return onResult(emptyList())
            val vc = VNDocumentCameraViewController()
            val d = ScanDelegate(onResult)
            activeDelegate = d
            vc.delegate = d
            topController()?.presentViewController(vc, true, null) ?: onResult(emptyList())
        }

        override fun files(onResult: (List<SharedFile>) -> Unit) {
            val picker = UIDocumentPickerViewController(forOpeningContentTypes = listOf(UTTypeItem), asCopy = true)
            picker.allowsMultipleSelection = true
            val d = FilesDelegate(onResult)
            activeDelegate = d
            picker.delegate = d
            topController()?.presentViewController(picker, true, null) ?: onResult(emptyList())
        }
    }
}

@OptIn(ExperimentalForeignApi::class, BetaInteropApi::class)
actual class AudioRecorder actual constructor() {
    private var recorder: AVAudioRecorder? = null
    private var url: NSURL? = null

    actual suspend fun start(): Boolean {
        val session = AVAudioSession.sharedInstance()
        val allowed = suspendCancellableCoroutine { cont -> session.requestRecordPermission { ok -> cont.resume(ok) } }
        if (!allowed) return false
        session.setCategory(AVAudioSessionCategoryPlayAndRecord, withOptions = AVAudioSessionCategoryOptionDefaultToSpeaker, error = null)
        session.setActive(true, error = null)
        val u = NSURL.fileURLWithPath(NSTemporaryDirectory() + "rec-${stamp()}.m4a")
        val settings = mapOf<Any?, Any?>(
            AVFormatIDKey to kAudioFormatMPEG4AAC.toInt(),
            AVSampleRateKey to 44100.0,
            AVNumberOfChannelsKey to 1,
            AVEncoderAudioQualityKey to AVAudioQualityHigh.toInt(),
        )
        val r = AVAudioRecorder(uRL = u, settings = settings, error = null)
        r.meteringEnabled = true
        if (!r.record()) return false
        recorder = r
        url = u
        return true
    }

    actual fun pause() { recorder?.pause() }
    actual fun resume() { recorder?.record() }

    actual fun level(): Float {
        val r = recorder ?: return 0f
        r.updateMeters()
        val db = r.averagePowerForChannel(0u).toDouble()
        return sqrt(10.0.pow(db / 20.0)).toFloat().coerceIn(0f, 1f)
    }

    actual fun stop(): SharedFile? {
        val r = recorder ?: return null
        recorder = null
        r.stop()
        AVAudioSession.sharedInstance().setActive(false, error = null)
        val u = url ?: return null
        url = null
        val data = NSData.dataWithContentsOfURL(u)?.toByteArray()
        NSFileManager.defaultManager.removeItemAtURL(u, error = null)
        return data?.takeIf { it.isNotEmpty() }?.let { SharedFile("recording-${stamp()}.m4a", "audio/mp4", it) }
    }

    actual fun cancel() {
        recorder?.let { it.stop(); it.deleteRecording() }
        recorder = null
        url = null
        AVAudioSession.sharedInstance().setActive(false, error = null)
    }
}

actual fun decodeImage(bytes: ByteArray, maxPx: Int): ImageBitmap? {
    val img = Image.makeFromEncoded(bytes)
    val k = min(1f, maxPx.toFloat() / min(img.width, img.height))
    if (k >= 1f) return img.toComposeImageBitmap()
    val w = max(1, (img.width * k).toInt())
    val h = max(1, (img.height * k).toInt())
    val surface = Surface.makeRasterN32Premul(w, h)
    surface.canvas.drawImageRect(img, Rect.makeWH(w.toFloat(), h.toFloat()))
    return surface.makeImageSnapshot().toComposeImageBitmap()
}

actual fun encodePng(image: ImageBitmap): ByteArray =
    Image.makeFromBitmap(image.asSkiaBitmap()).encodeToData(EncodedImageFormat.PNG)?.bytes ?: ByteArray(0)

actual fun appVersion(): String = NSBundle.mainBundle.infoDictionary?.get("CFBundleShortVersionString") as? String ?: "?"
