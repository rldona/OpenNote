package app.opennote.sync

actual fun env(name: String): String? = System.getenv(name)
