'use strict';

const SonoffBase = require('../drivers/sonoffbase');
const { Cluster, CLUSTER, BoundCluster } = require('zigbee-clusters');
const SonoffCluster = require('./SonoffCluster');

Cluster.addCluster(SonoffCluster);

// Maps the subDeviceId from the pairing manifest to the physical endpoint it controls.
// The root device (no subDeviceId) is channel 1 / endpoint 1.
const SUBDEVICE_ENDPOINT = {
    undefined: 1,
    channel2: 2,
    channel3: 3,
};

class ZBM5SplitOnOffBoundCluster extends BoundCluster {
    constructor(device) {
        super();
        this.device = device;
    }
    toggle() {
        const buttonId = String(this.device.endpointId);
        this.device.log('Physical rocker toggle, endpoint', buttonId);
        this.device._clickTrigger
            .trigger(this.device, { button: buttonId }, { button: buttonId })
            .catch(this.device.error);
    }
}

// Shared device implementation for the per-channel ("split") ZBM5 drivers.
// Each Homey device instance controls exactly one endpoint, resolved from its
// subDeviceId. Used by ZBM5-1C-split, ZBM5-2C-split and ZBM5-3C-split.
class ZBM5SplitDevice extends SonoffBase {

    async onNodeInit({ zclNode }) {
        await super.onNodeInit({ zclNode });

        const { subDeviceId } = this.getData();
        this.endpointId = SUBDEVICE_ENDPOINT[subDeviceId] || 1;
        this.log('ZBM5-split init — subDeviceId:', subDeviceId, '-> endpoint', this.endpointId);

        this._clickTrigger = this.homey.flow.getDeviceTriggerCard(this.driver.id + ':click');
        this._ignoreReportUntil = 0;

        this.registerCapability('onoff', CLUSTER.ON_OFF, {
            endpoint: this.endpointId,
            set: (value) => {
                this._ignoreReportUntil = Date.now() + 2000;
                return value ? 'setOn' : 'setOff';
            },
            setParser: () => ({}),
        });

        const endpoint = zclNode.endpoints[this.endpointId];
        if (endpoint) {
            endpoint.bind(CLUSTER.ON_OFF.NAME, new ZBM5SplitOnOffBoundCluster(this));
            endpoint.clusters.onOff.on('attr.onOff', (value) => this._onOnOffReport(value));
        }
    }

    _onOnOffReport(value) {
        if (typeof value === 'boolean') {
            this.setCapabilityValue('onoff', value).catch(this.error);
        }
        if (Date.now() < this._ignoreReportUntil) {
            this.log('Ignoring onOff report on endpoint', this.endpointId, '(Homey-initiated)');
            return;
        }
        this.log('Physical rocker toggle (from state report), endpoint', this.endpointId);
        const buttonId = String(this.endpointId);
        this._clickTrigger.trigger(this, { button: buttonId }, { button: buttonId }).catch(this.error);
    }
}

module.exports = ZBM5SplitDevice;
