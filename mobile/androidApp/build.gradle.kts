plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
}

android {
    namespace = "app.opennote.android"
    compileSdk = libs.versions.android.compileSdk.get().toInt()
    defaultConfig {
        applicationId = "app.opennote"
        minSdk = libs.versions.android.minSdk.get().toInt()
        targetSdk = libs.versions.android.compileSdk.get().toInt()
        versionCode = 1
        versionName = "0.0.1"
    }
    buildTypes {
        release {
            isMinifyEnabled = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            // Local performance checks only: release builds for the stores are signed in CI with the real key.
            signingConfig = signingConfigs.getByName("debug")
        }
    }
    sourceSets["main"].assets.directories.add(layout.buildDirectory.dir("generated/editorAssets").get().asFile.path)
}

kotlin { jvmToolchain(21) }

dependencies {
    implementation(project(":composeApp"))
    implementation(libs.androidx.activity.compose)
}

// The note editor is the web build of web/src/embed (npm run build:embed -w web), shipped as app assets under editor/.
val copyEditor by tasks.registering(Copy::class) {
    from(rootDir.resolve("../web/dist-embed"))
    into(layout.buildDirectory.dir("generated/editorAssets/editor"))
}
tasks.named("preBuild") { dependsOn(copyEditor) }
