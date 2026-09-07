'use strict';

const SonoffBase = require('../sonoffbase');
const { Cluster, CLUSTER, BoundCluster } = require('zigbee-clusters');
const SonoffCluster = require('../../lib/SonoffCluster');

Cluster.addCluster(SonoffCluster);

const CHANNEL_ENDPOINTS = {
    onoff: 1,
    'onoff.l2': 2,
};

class MINIZB2GSOnOffBoundCluster extends BoundCluster {
    constructor(device, buttonId) {
        super();
        this.device = device;
        this.buttonId = String(buttonId);
    }
    toggle() {
        this.device.log('Physical rocker toggle, button', this.buttonId);
        const tokens = { button: this.buttonId };
        const state = { button: this.buttonId };
        this.device._clickTrigger.trigger(this.device, tokens, state).catch(this.device.error);
    }
}

class SonoffMINIZB2GS extends SonoffBase {

    async onNodeInit({ zclNode }) {
        super.onNodeInit({ zclNode });

        this._clickTrigger = this.homey.flow.getDeviceTriggerCard(this.driver.id + ':click');
        this._ignoreReportUntil = {};

        for (const [capability, endpointId] of Object.entries(CHANNEL_ENDPOINTS)) {
            if (!this.hasCapability(capability)) {
                await this.addCapability(capability).catch(this.error);
            }
            this.registerCapability(capability, CLUSTER.ON_OFF, {
                endpoint: endpointId,
                set: (value) => {
                    this._ignoreReportUntil[endpointId] = Date.now() + 2000;
                    return value ? 'setOn' : 'setOff';
                },
                setParser: () => ({}),
            });

            const endpoint = zclNode.endpoints[endpointId];
            if (endpoint) {
                endpoint.bind(CLUSTER.ON_OFF.NAME, new MINIZB2GSOnOffBoundCluster(this, endpointId));
                endpoint.clusters.onOff.on('attr.onOff',
                    (value) => this._onOnOffReport(endpointId, capability, value));
            }
        }

        this.checkAttributes();
    }

    _onOnOffReport(endpointId, capability, value) {
        if (typeof value === 'boolean') {
            this.setCapabilityValue(capability, value).catch(this.error);
        }
        const ignoreUntil = this._ignoreReportUntil[endpointId] || 0;
        if (Date.now() < ignoreUntil) {
            this.log('Ignoring onOff report from endpoint', endpointId, '(Homey-initiated)');
            return;
        }
        this.log('Physical rocker toggle (from state report), button', endpointId);
        const buttonId = String(endpointId);
        this._clickTrigger.trigger(this, { button: buttonId }, { button: buttonId }).catch(this.error);
    }

    async onSettings({ oldSettings, newSettings, changedKeys }) {
        const sonoffData = {};

        if (changedKeys.includes('network_indicator')) {
            try {
                await this.zclNode.endpoints[1].clusters[SonoffCluster.NAME].writeAttributes({
                    network_led: newSettings.network_indicator,
                });
            } catch (err) {
                this.error('Failed to set network_indicator', err);
            }
        }

        for (const [settingKey, endpointId] of [['switch_mode_l1', 1], ['switch_mode_l2', 2]]) {
            if (!changedKeys.includes(settingKey)) continue;
            const cluster = this.zclNode.endpoints[endpointId]?.clusters?.[SonoffCluster.NAME];
            if (!cluster) {
                this.log('switch_mode write skipped — no SonoffCluster on endpoint', endpointId);
                continue;
            }
            const value = parseInt(newSettings[settingKey], 10);
            try {
                this.log('Writing switch_mode on endpoint', endpointId, '=', value);
                await cluster.writeAttributes({ switch_mode: value });
            } catch (err) {
                this.error('Failed to set ' + settingKey, err && err.message ? err.message : err);
            }
        }

        if (changedKeys.some(k => k.startsWith('detach_relay_l'))) {
            sonoffData.detach_relay_mode2 =
                (newSettings.detach_relay_l1 ? 0x01 : 0) |
                (newSettings.detach_relay_l2 ? 0x02 : 0);
        }

        if (Object.keys(sonoffData).length > 0) {
            try {
                this.log('Writing attributes:', JSON.stringify(sonoffData));
                await this.zclNode.endpoints[1].clusters[SonoffCluster.NAME].writeAttributes(sonoffData);
                this.log('Write OK');
            } catch (err) {
                this.error('Write FAILED:', err && err.message ? err.message : err);
            }
        }
    }

    async checkAttributes() {
        this.readAttribute(SonoffCluster, ['detach_relay_mode2'], (data) => {
            if (data.detach_relay_mode2 !== undefined && data.detach_relay_mode2 !== null) {
                const m = data.detach_relay_mode2;
                this.setSettings({
                    detach_relay_l1: !!m.l1,
                    detach_relay_l2: !!m.l2,
                }).catch(this.error);
            }
        });

        for (const [settingKey, endpointId] of [['switch_mode_l1', 1], ['switch_mode_l2', 2]]) {
            const cluster = this.zclNode.endpoints[endpointId]?.clusters?.[SonoffCluster.NAME];
            if (!cluster) {
                this.log('switch_mode read skipped — no SonoffCluster on endpoint', endpointId);
                continue;
            }
            try {
                const result = await cluster.readAttributes('switch_mode');
                if (result && result.switch_mode !== undefined && result.switch_mode !== null) {
                    await this.setSettings({ [settingKey]: String(result.switch_mode) }).catch(this.error);
                }
            } catch (err) {
                this.log('switch_mode read on endpoint', endpointId, 'failed:', err && err.message ? err.message : err);
            }
        }
    }
}

module.exports = SonoffMINIZB2GS;
