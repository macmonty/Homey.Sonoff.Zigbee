'use strict';

const { ZigBeeDriver } = require('homey-zigbeedriver');

class SonoffZBM51CsplitDriver extends ZigBeeDriver {
    async onInit() {
        this.homey.flow.getDeviceTriggerCard(this.id + ':click')
            .registerRunListener(async (args, state) => args.button === state.button);
    }
}

module.exports = SonoffZBM51CsplitDriver;
