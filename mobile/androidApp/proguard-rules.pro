# The editor page calls postMessage on the object exposed with addJavascriptInterface.
-keepclassmembers class * { @android.webkit.JavascriptInterface <methods>; }

# WorkManager (background sync) creates its Room database by reflection.
-keep class * extends androidx.room.RoomDatabase { <init>(); }
