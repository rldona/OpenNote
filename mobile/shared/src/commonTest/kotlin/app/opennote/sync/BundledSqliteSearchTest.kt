package app.opennote.sync

import androidx.sqlite.SQLiteConnection
import androidx.sqlite.driver.bundled.BundledSQLiteDriver
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlin.time.measureTime

/**
 * Phase 0 spike: the SQLite bundled with the app (the same on Android and iOS) runs OpenNote's real schema
 * (server/src/schema.ts) and the search features the store relies on: FTS5, accent-insensitive matching
 * (unicode61 remove_diacritics 2), prefixes, phrases, NOT, and bm25 ranking with the title weighted.
 */
class BundledSqliteSearchTest {
    private fun schemaStatements(): List<String> {
        val ts = readText("$REPO/server/src/schema.ts")
        val sql = ts.substringAfter("export const SCHEMA = `").substringBefore("`;")
        return sql.split(";").map { it.trim() }.filter { it.isNotEmpty() && !it.lineSequence().all { l -> l.isBlank() || l.trim().startsWith("--") } }
    }

    private fun SQLiteConnection.run(sql: String, vararg args: Any?) {
        prepare(sql).use { st ->
            args.forEachIndexed { i, a ->
                when (a) {
                    null -> st.bindNull(i + 1)
                    is String -> st.bindText(i + 1, a)
                    is Long -> st.bindLong(i + 1, a)
                    is Int -> st.bindLong(i + 1, a.toLong())
                    else -> error("unsupported $a")
                }
            }
            while (st.step()) { }
        }
    }

    private fun SQLiteConnection.titles(sql: String, arg: String): List<String> = prepare(sql).use { st ->
        st.bindText(1, arg)
        buildList { while (st.step()) add(st.getText(0)) }
    }

    @Test
    fun realSchemaWithFts5AndRanking() {
        val db = BundledSQLiteDriver().open(":memory:")
        for (s in schemaStatements()) db.run(s)

        db.run("INSERT INTO notebooks (id, name, stack, created_at) VALUES ('nb', 'Viajes', NULL, 0)")
        val words = listOf("informe", "reunión", "presupuesto", "equipo", "cliente", "diseño", "tarea", "viaje", "factura", "proyecto")
        val fill = (0 until 300).joinToString(" ") { words[it % words.size] }
        val insert = measureTime {
            db.run("BEGIN")
            for (i in 0 until 5000) {
                val id = "n$i"
                db.run("INSERT INTO notes (id, notebook_id, title, content, text, created_at, updated_at) VALUES (?, 'nb', ?, '', ?, ?, ?)", id, "Nota $i", fill, i.toLong(), i.toLong())
                db.run("INSERT INTO notes_fts (note_id, title, body) VALUES (?, ?, ?)", id, "Nota $i", fill)
            }
            db.run("INSERT INTO notes (id, notebook_id, title, content, text, created_at, updated_at) VALUES ('cafe-body', 'nb', 'Desayuno', '', 'Un café con leche en el Foro Romano', 1, 1)")
            db.run("INSERT INTO notes_fts (note_id, title, body) VALUES ('cafe-body', 'Desayuno', 'Un café con leche en el Foro Romano')")
            db.run("INSERT INTO notes (id, notebook_id, title, content, text, created_at, updated_at) VALUES ('cafe-title', 'nb', 'Café de Lisboa', '', 'nada más', 2, 2)")
            db.run("INSERT INTO notes_fts (note_id, title, body) VALUES ('cafe-title', 'Café de Lisboa', 'nada más')")
            db.run("COMMIT")
        }
        println("indexed 5 002 notes of ~300 words in $insert")

        val search = "SELECT n.title FROM notes n JOIN notes_fts f ON f.note_id = n.id WHERE notes_fts MATCH ? ORDER BY bm25(notes_fts, 0, 5, 1), n.updated_at DESC"
        // Accent-insensitive, both ways, and the title hit ranks first.
        assertEquals(listOf("Café de Lisboa", "Desayuno"), db.titles(search, "cafe"))
        assertEquals(listOf("Café de Lisboa", "Desayuno"), db.titles(search, "CAFÉ"))
        assertEquals(listOf("Desayuno"), db.titles(search, "\"foro romano\""))
        assertEquals(listOf("Desayuno"), db.titles(search, "rom*"))
        assertEquals(listOf("Café de Lisboa"), db.titles(search, "cafe NOT leche"))

        var hits = 0
        val took = measureTime { hits = db.titles(search, "reunion presupuesto").size }
        println("search over 5 002 notes: $hits hits in $took")
        assertEquals(5000, hits)
        assertTrue(took.inWholeMilliseconds < 1000, "search took $took")
        db.close()
    }
}
