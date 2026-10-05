package app.myfitnessplan.tv

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ServerAddressTest {
    @Test fun addsSchemeAndDefaultPort() {
        assertEquals("http://192.168.1.20:7777", ServerAddress.normalize("192.168.1.20"))
    }

    @Test fun keepsTypedPort() {
        assertEquals("http://192.168.1.20:8123", ServerAddress.normalize("192.168.1.20:8123"))
    }

    @Test fun acceptsWhatTheTrayShows() {
        assertEquals("http://192.168.1.20:7777", ServerAddress.normalize("  http://192.168.1.20:7777/ "))
    }

    @Test fun dropsAnyPath() {
        assertEquals("http://my-mac.local:7777", ServerAddress.normalize("my-mac.local:7777/plans"))
    }

    @Test fun httpsDefaultsTo443() {
        assertEquals("https://gym.example.com:443", ServerAddress.normalize("https://gym.example.com"))
    }

    @Test fun acceptsSpacesOrCommasForDots() {
        assertEquals("http://192.168.1.20:7777", ServerAddress.normalize("192 168 1 20"))
        assertEquals("http://192.168.1.20:7777", ServerAddress.normalize("192,168,1,20"))
        assertEquals("http://192.168.1.20:8123", ServerAddress.normalize("192 168 1 20 8123"))
        assertEquals("http://192.168.1.20:7777", ServerAddress.normalize("192.168.1.20 7777"))
        assertNull(ServerAddress.normalize("192 168 1"))
    }

    @Test fun rejectsNonsense() {
        assertNull(ServerAddress.normalize(""))
        assertNull(ServerAddress.normalize("   "))
        assertNull(ServerAddress.normalize("ftp://192.168.1.20"))
        assertNull(ServerAddress.normalize("http://"))
        assertNull(ServerAddress.normalize("192.168.1.20:99999"))
    }

    @Test fun displayDropsHttp() {
        assertEquals("192.168.1.20:7777", ServerAddress.display("http://192.168.1.20:7777"))
    }

    @Test fun sameOrigin() {
        val base = "http://192.168.1.20:7777"
        assertTrue(ServerAddress.isSameOrigin(base, "http://192.168.1.20:7777/player/abc"))
        assertFalse(ServerAddress.isSameOrigin(base, "http://192.168.1.21:7777/"))
        assertFalse(ServerAddress.isSameOrigin(base, "http://192.168.1.20:8080/"))
        assertFalse(ServerAddress.isSameOrigin(base, "https://www.youtube.com/watch?v=x"))
    }
}
