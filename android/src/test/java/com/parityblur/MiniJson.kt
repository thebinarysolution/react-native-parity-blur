package com.parityblur

/**
 * Minimal, dependency-free JSON parser used only by [PipelineFixturesTest] to load
 * `test/pipeline-fixtures.json`. Deliberately hand-rolled (no Gson/Moshi/org.json dependency) so
 * the Milestone 3 unit-test setup does not need a new external dependency resolved at build
 * time -- the fixture file's shape (objects/arrays/numbers/strings/booleans, no unicode escapes
 * beyond the basics) is fully covered by this small recursive-descent parser.
 *
 * Parses into plain Kotlin values: `Map<String, Any?>`, `List<Any?>`, `Double`, `String`,
 * `Boolean`, or `null`.
 */
object MiniJson {

  fun parse(text: String): Any? {
    val p = Parser(text)
    p.skipWhitespace()
    val value = p.parseValue()
    p.skipWhitespace()
    check(p.atEnd()) { "Trailing content after JSON value at index ${p.pos}" }
    return value
  }

  private class Parser(private val s: String) {
    var pos = 0

    fun atEnd() = pos >= s.length

    fun skipWhitespace() {
      while (pos < s.length && s[pos].isWhitespace()) pos++
    }

    fun parseValue(): Any? {
      skipWhitespace()
      require(pos < s.length) { "Unexpected end of JSON input" }
      return when (s[pos]) {
        '{' -> parseObject()
        '[' -> parseArray()
        '"' -> parseString()
        't' -> parseLiteral("true", true)
        'f' -> parseLiteral("false", false)
        'n' -> parseLiteral("null", null)
        else -> parseNumber()
      }
    }

    private fun parseLiteral(literal: String, value: Any?): Any? {
      require(s.startsWith(literal, pos)) { "Expected '$literal' at index $pos" }
      pos += literal.length
      return value
    }

    private fun parseObject(): Map<String, Any?> {
      val map = LinkedHashMap<String, Any?>()
      pos++ // '{'
      skipWhitespace()
      if (pos < s.length && s[pos] == '}') {
        pos++
        return map
      }
      while (true) {
        skipWhitespace()
        val key = parseString()
        skipWhitespace()
        require(pos < s.length && s[pos] == ':') { "Expected ':' at index $pos" }
        pos++
        val value = parseValue()
        map[key] = value
        skipWhitespace()
        require(pos < s.length) { "Unterminated object" }
        when (s[pos]) {
          ',' -> {
            pos++
          }
          '}' -> {
            pos++
            return map
          }
          else -> throw IllegalArgumentException("Expected ',' or '}' at index $pos")
        }
      }
    }

    private fun parseArray(): List<Any?> {
      val list = ArrayList<Any?>()
      pos++ // '['
      skipWhitespace()
      if (pos < s.length && s[pos] == ']') {
        pos++
        return list
      }
      while (true) {
        list.add(parseValue())
        skipWhitespace()
        require(pos < s.length) { "Unterminated array" }
        when (s[pos]) {
          ',' -> {
            pos++
          }
          ']' -> {
            pos++
            return list
          }
          else -> throw IllegalArgumentException("Expected ',' or ']' at index $pos")
        }
      }
    }

    private fun parseString(): String {
      require(pos < s.length && s[pos] == '"') { "Expected string at index $pos" }
      pos++
      val sb = StringBuilder()
      while (true) {
        require(pos < s.length) { "Unterminated string" }
        val c = s[pos]
        when {
          c == '"' -> {
            pos++
            return sb.toString()
          }
          c == '\\' -> {
            pos++
            require(pos < s.length) { "Unterminated escape" }
            when (val esc = s[pos]) {
              '"' -> sb.append('"')
              '\\' -> sb.append('\\')
              '/' -> sb.append('/')
              'b' -> sb.append('\b')
              'f' -> sb.append('\u000C')
              'n' -> sb.append('\n')
              'r' -> sb.append('\r')
              't' -> sb.append('\t')
              'u' -> {
                val hex = s.substring(pos + 1, pos + 5)
                sb.append(hex.toInt(16).toChar())
                pos += 4
              }
              else -> throw IllegalArgumentException("Invalid escape '\\$esc' at index $pos")
            }
            pos++
          }
          else -> {
            sb.append(c)
            pos++
          }
        }
      }
    }

    private fun parseNumber(): Double {
      val start = pos
      if (pos < s.length && (s[pos] == '-' || s[pos] == '+')) pos++
      while (pos < s.length && (s[pos].isDigit() || s[pos] == '.' || s[pos] == 'e' || s[pos] == 'E' ||
          s[pos] == '+' || s[pos] == '-')
      ) {
        pos++
      }
      val token = s.substring(start, pos)
      require(token.isNotEmpty()) { "Expected number at index $start" }
      return token.toDouble()
    }
  }
}

// -------------------------------------------------------------------- convenience accessors

@Suppress("UNCHECKED_CAST")
fun Any?.asJsonObject(): Map<String, Any?> = this as Map<String, Any?>

@Suppress("UNCHECKED_CAST")
fun Any?.asJsonArray(): List<Any?> = this as List<Any?>

fun Any?.asJsonDouble(): Double = this as Double

fun Any?.asJsonInt(): Int = (this as Double).toInt()

fun Any?.asJsonString(): String = this as String

fun Any?.asJsonBoolean(): Boolean = this as Boolean
