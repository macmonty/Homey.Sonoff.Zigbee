'use strict';

const { ZigBeeDevice } = require('homey-zigbeedriver');
const { CLUSTER } = require('zigbee-clusters');

class SonoffBASICZBR3 extends ZigBeeDevice {

    async onNodeInit({ zclNode }) {
        this.log('BASICZBR3 initialized');
        this.printNode();

        if (this.hasCapability('onoff')) {
            this.registerCapability('onoff', CLUSTER.ON_OFF);
        }
        // Note: BASICZBR3 firmware does not implement configureReporting on
        // genOnOff, so we don't try to configure it. The default registerCapability
        // handler polls and listens for unsolicited reports.
    }

    async onDeleted() {
        this.log('BASICZBR3 removed');
    }
}

module.exports = SonoffBASICZBR3;
