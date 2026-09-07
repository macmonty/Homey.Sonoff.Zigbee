const { Cluster, ZCLDataTypes } = require("zigbee-clusters");

// Sonoff custom cluster 0xFC12.
// First seen on SNZB-01M (Orb 4-in-1 scene button) where it carries
// the keyActionEvent attribute (1=single, 2=double, 3=long, 4=triple).
// Named generically (Cluster2) so other Sonoff devices using 0xFC12
// can reuse it.
class SonoffCluster2 extends Cluster {

    static get ID() {
        return 64530; // 0xFC12
    }

    static get NAME() {
        return 'SonoffCluster2';
    }

    static get ATTRIBUTES() {
        return {
            keyActionEvent: {
                id: 0x0000,
                type: ZCLDataTypes.uint8
            },
        };
    }

    static get COMMANDS() {
        return {};
    }
}

module.exports = SonoffCluster2;
