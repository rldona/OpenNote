// OpenNote for Android and iOS (Kotlin Multiplatform). See docs/SYNC-FORMAT.md for the contract with the TypeScript apps.
rootProject.name = "opennote-mobile"

pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositories {
        google()
        mavenCentral()
    }
}

include(":shared", ":composeApp", ":androidApp")
