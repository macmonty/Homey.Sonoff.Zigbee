'use strict';

const { ZigBeeDriver } = require('homey-zigbeedriver');

class SonoffZBM5Driver extends ZigBeeDriver {

    async onInit() {
        this.homey.flow.getDeviceTriggerCard(this.id + ':click')
            .registerRunListener(async (args, state) => {
                return args.button === state.button;
            });
    }
}

module.exports = SonoffZBM5Driver;
