'use strict';

const { ZigBeeDriver } = require('homey-zigbeedriver');

class SonoffMINIZB2GSLDriver extends ZigBeeDriver {

    async onInit() {
        this.homey.flow.getDeviceTriggerCard(this.id + ':click')
            .registerRunListener(async (args, state) => {
                return args.button === state.button;
            });
    }
}

module.exports = SonoffMINIZB2GSLDriver;
