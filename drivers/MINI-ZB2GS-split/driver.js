'use strict';

const { ZigBeeDriver } = require('homey-zigbeedriver');

class SonoffMINIZB2GSsplitDriver extends ZigBeeDriver {

    async onInit() {
        this.homey.flow.getDeviceTriggerCard(this.id + ':click')
            .registerRunListener(async (args, state) => {
                return args.button === state.button;
            });
    }
}

module.exports = SonoffMINIZB2GSsplitDriver;
