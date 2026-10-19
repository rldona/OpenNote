# The editor page calls postMessage on the object exposed with addJavascriptInterface.
-keepclassmembers class * { @android.webkit.JavascriptInterface <methods>; }
