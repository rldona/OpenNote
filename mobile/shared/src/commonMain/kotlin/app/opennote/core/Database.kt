package app.opennote.core

import androidx.sqlite.SQLITE_DATA_BLOB
import androidx.sqlite.SQLITE_DATA_FLOAT
import androidx.sqlite.SQLITE_DATA_INTEGER
import androidx.sqlite.SQLITE_DATA_NULL
import androidx.sqlite.SQLiteConnection
import androidx.sqlite.SQLiteStatement
import androidx.sqlite.driver.bundled.BundledSQLiteDriver

/** A row as a column name → value map: Long, Double, String, ByteArray or null. */
typealias Row = Map<String, Any?>

/**
 * The small slice of SQL the store needs, over the SQLite bundled with the app (the same build on Android and iOS, with
 * FTS5). Synchronous, like the TypeScript store's SqlDatabase (server/src/sql.ts): call it off the main thread.
 */
class Database private constructor(private val conn: SQLiteConnection) {
    /** Runs one or more statements without parameters or results (schema, BEGIN/COMMIT). */
    fun exec(sql: String) {
        for (statement in splitStatements(sql)) conn.prepare(statement).use { st -> while (st.step()) Unit }
    }

    fun run(sql: String, vararg params: Any?) {
        conn.prepare(sql).use { st ->
            bind(st, params)
            while (st.step()) Unit
        }
    }

    fun one(sql: String, vararg params: Any?): Row? = conn.prepare(sql).use { st ->
        bind(st, params)
        if (st.step()) readRow(st) else null
    }

    fun all(sql: String, vararg params: Any?): List<Row> = conn.prepare(sql).use { st ->
        bind(st, params)
        buildList { while (st.step()) add(readRow(st)) }
    }

    fun close() = conn.close()

    private fun bind(st: SQLiteStatement, params: Array<out Any?>) {
        params.forEachIndexed { i, p ->
            val at = i + 1
            when (p) {
                null -> st.bindNull(at)
                is String -> st.bindText(at, p)
                is Long -> st.bindLong(at, p)
                is Int -> st.bindLong(at, p.toLong())
                is Boolean -> st.bindLong(at, if (p) 1 else 0)
                is Double -> st.bindDouble(at, p)
                is ByteArray -> st.bindBlob(at, p)
                else -> throw IllegalArgumentException("cannot bind ${p::class}")
            }
        }
    }

    private fun readRow(st: SQLiteStatement): Row {
        val row = LinkedHashMap<String, Any?>()
        for (i in 0 until st.getColumnCount()) {
            row[st.getColumnName(i)] = when (st.getColumnType(i)) {
                SQLITE_DATA_NULL -> null
                SQLITE_DATA_INTEGER -> st.getLong(i)
                SQLITE_DATA_FLOAT -> st.getDouble(i)
                SQLITE_DATA_BLOB -> st.getBlob(i)
                else -> st.getText(i)
            }
        }
        return row
    }

    companion object {
        /** Opens (or creates) a database file, or ":memory:", and brings its schema up to date. */
        fun open(path: String): Database = Database(BundledSQLiteDriver().open(path)).also { initSchema(it) }

        /** The schema has no triggers, so statements end at every `;`. */
        internal fun splitStatements(sql: String): List<String> =
            sql.split(';').map { it.trim() }.filter { s -> s.lineSequence().any { l -> l.isNotBlank() && !l.trim().startsWith("--") } }
    }
}

/** Mirror of initSchema/migrate in server/src/schema.ts. */
internal fun initSchema(db: Database) {
    db.exec(SCHEMA)
    val cols = db.all("PRAGMA table_info(notes)").map { it["name"] as String }
    if ("is_template" !in cols) db.exec("ALTER TABLE notes ADD COLUMN is_template INTEGER NOT NULL DEFAULT 0")
    // is_template = 2 marks built-in starter templates: per device, never synced.
    if (db.one("SELECT 1 FROM meta WHERE key = 'migration.builtin-templates'") == null) {
        db.exec(
            """UPDATE notes SET is_template = 2 WHERE is_template = 1 AND created_at = updated_at AND title IN
            ('Project plan','To-do list','Weekly review','Meeting notes','Plan de proyecto','Lista de tareas','Revisión semanal','Acta de reunión')""",
        )
        db.exec("INSERT INTO meta (key, value) VALUES ('migration.builtin-templates', '1')")
    }
}
