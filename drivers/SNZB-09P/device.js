'use strict';

const SonoffBase = require('../sonoffbase');
const { Cluster, BoundCluster } = require('zigbee-clusters');
const SonoffCluster = require('../../lib/SonoffCluster');

Cluster.addCluster(SonoffCluster);

// SNZB-09P reports its own alert state (triggered manually on the device,
// via a scene, or cancelled) by sending the same 'alertCommand' back to us.
// Confirmed against zigbee-herdsman-converters' snzb_09p_alert fromZigbee
// converter: data[1] is the alarm type (0=none, 1=manual, 2=scene).
class SirenAlertBoundCluster extends BoundCluster {
    constructor(device) {
        super();
        this.device = device;
    }

    alertCommand({ data } = {}) {
        if (!data || data.length < 2) return;
        const alarmType = { 0: 'none', 1: 'manual', 2: 'scene' }[data[1]];
        if (alarmType === undefined) return;
        this.device.log('Siren alert state', alarmType);
        this.device.setCapabilityValue('onoff', alarmType !== 'none').catch(this.device.error);
    }
}

class SonoffSNZB09P extends SonoffBase {

    async onNodeInit({ zclNode }) {
        super.onNodeInit({ zclNode });

        zclNode.endpoints[1].bind(SonoffCluster.NAME, new SirenAlertBoundCluster(this));

        this.registerCapability('alarm_tamper', SonoffCluster, {
            report: 'tamper',
            reportParser: value => Boolean(value),
            get: 'tamper',
            getParser: value => Boolean(value),
            getOpts: { getOnStart: true, getOnOnline: true }
        });

        this.registerCapabilityListener('onoff', async value => {
            const cluster = this.zclNode.endpoints[1].clusters[SonoffCluster.NAME];
            if (value) {
                const settings = this.getSettings();
                const payload = SonoffCluster.createAlertPayload({
                    soundEnable: settings.alarm_sound_enable !== false,
                    lightEnable: settings.alarm_light_enable !== false,
                    soundType: parseInt(settings.alarm_sound_type) || 0,
                    volumeLevel: parseInt(settings.alarm_volume_level) || 1,
                    durationSeconds: settings.alarm_duration || 60,
                });
                await cluster.alertCommand({ data: payload });
            } else {
                await cluster.alertCommand({ data: SonoffCluster.createCancelAlertPayload() });
            }
        });
    }

    async checkAttributes() {
        await this.readAttribute(SonoffCluster, ['tamper'], (data) => {
            this.setCapabilityValue('alarm_tamper', Boolean(data.tamper)).catch(this.error);
        });
    }

}

module.exports = SonoffSNZB09P;
