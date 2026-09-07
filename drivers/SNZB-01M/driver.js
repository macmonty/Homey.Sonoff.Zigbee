'use strict';

const { ZigBeeDriver } = require('homey-zigbeedriver');

class SonoffSNZB01MDriver extends ZigBeeDriver {

    async onInit() {
        this.homey.flow.getDeviceTriggerCard(this.id + ':button_action')
            .registerRunListener(async (args, state) => {
                return args.button === state.button && args.action === state.action;
            });
    }
}

module.exports = SonoffSNZB01MDriver;
