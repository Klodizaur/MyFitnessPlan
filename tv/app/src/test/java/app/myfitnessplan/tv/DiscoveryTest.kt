package app.myfitnessplan.tv

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class DiscoveryTest {
    @Test fun homeNetworkIsAllOtherAddresses() {
        val hosts = Discovery.hostsToScan("192.168.1.37", 24)
        assertEquals(253, hosts.size) // .1 to .254, minus the TV itself
        assertEquals("192.168.1.1", hosts.first())
        assertEquals("192.168.1.254", hosts.last())
        assertFalse("192.168.1.37" in hosts)
    }

    @Test fun widerNetworksAreNarrowedToTheTvsSlash24() {
        val hosts = Discovery.hostsToScan("10.0.5.20", 16)
        assertEquals(253, hosts.size)
        assertTrue(hosts.all { it.startsWith("10.0.5.") })
    }

    @Test fun smallNetworks() {
        // A /30 holds .0 (network), .1, .2, .3 (broadcast); the TV is .1.
        assertEquals(listOf("192.168.1.2"), Discovery.hostsToScan("192.168.1.1", 30))
    }

    @Test fun nonsenseGivesNothing() {
        assertEquals(emptyList<String>(), Discovery.hostsToScan("not an ip", 24))
        assertEquals(emptyList<String>(), Discovery.hostsToScan("300.1.1.1", 24))
    }
}
