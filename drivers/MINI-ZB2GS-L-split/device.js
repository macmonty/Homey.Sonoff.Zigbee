'use strict';

const SonoffBase = require('../sonoffbase');
const { Cluster, CLUSTER, BoundCluster } = require('zigbee-clusters');
const SonoffCluster = require('../../lib/SonoffCluster');

Cluster.addCluster(SonoffCluster);

// Maps the subDeviceId from the pairing manifest to the physical endpoint it controls.
// The root device (no subDeviceId) is channel 1 / endpoint 1.
const SUBDEVICE_ENDPOINT = {
    undefined: 1,
    channel2: 2,
};

class SonoffMINIZB2GSLsplit extends SonoffBase {

    async onNodeInit({ zclNode }) {
        super.onNodeInit({ zclNode });

        const { subDeviceId } = this.getData();
        this.endpointId = SUBDEVICE_ENDPOINT[subDeviceId] || 1;
        this.log('MINI-ZB2GS-L-split init — subDeviceId:', subDeviceId, '-> endpoint', this.endpointId);

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
            endpoint.bind(CLUSTER.ON_OFF.NAME, new MINIZB2GSLsplitOnOffBoundCluster(this));
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

class MINIZB2GSLsplitOnOffBoundCluster extends BoundCluster {
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

module.exports = SonoffMINIZB2GSLsplit;
