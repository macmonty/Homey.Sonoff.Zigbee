'use strict';

const SonoffBase = require('../sonoffbase');
const { Cluster, CLUSTER, BoundCluster } = require('zigbee-clusters');
const SonoffCluster = require('../../lib/SonoffCluster');

Cluster.addCluster(SonoffCluster);

// Map sub-capability suffix -> endpoint id.
// onoff (no suffix) -> ep 1, onoff.l2 -> ep 2, onoff.l3 -> ep 3.
const CHANNEL_ENDPOINTS = {
    onoff: 1,
    'onoff.l2': 2,
    'onoff.l3': 3,
};

// Listens for onOff toggle commands the device sends when the physical rocker
// is pressed (most useful when detach-relay-mode is enabled for that channel).
class ZBM5OnOffBoundCluster extends BoundCluster {
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

class SonoffZBM5 extends SonoffBase {

    async onNodeInit({ zclNode }) {
        super.onNodeInit({ zclNode });

        this._clickTrigger = this.homey.flow.getDeviceTriggerCard(this.driver.id + ':click');
        // Per-endpoint timestamps: ignore the onOff attribute report that
        // immediately follows a Homey-initiated on/off command, so click only
        // fires on physical rocker presses.
        this._ignoreReportUntil = {};

        // Determine channel count from productId — ZBM5 devices always expose
        // 3 onOff endpoints regardless of physical channel count, so we must
        // read the model name to know how many to surface as capabilities.
        // Try the built-in 'zb_product_id' setting first, fall back to reading
        // basic.modelId from the device, and cache the resolved value.
        let productId = this.getSetting('zb_product_id')
            || this.getStoreValue('zbm5_productId')
            || '';
        if (!productId) {
            try {
                const basic = await zclNode.endpoints[1].clusters.basic.readAttributes('modelId');
                productId = basic.modelId || '';
            } catch (err) {
                this.error('Failed to read basic.modelId', err);
            }
        }
        if (productId) {
            await this.setStoreValue('zbm5_productId', productId).catch(this.error);
        }
        const channelCount = this._channelCountFromProductId(productId);
        this.log('ZBM5 productId:', productId, 'channelCount:', channelCount);

        for (const [capability, endpointId] of Object.entries(CHANNEL_ENDPOINTS)) {
            const inUse = endpointId <= channelCount;

            if (!inUse) {
                if (this.hasCapability(capability)) {
                    this.log(`Removing unused capability ${capability} (channelCount=${channelCount})`);
                    await this.removeCapability(capability).catch(this.error);
                }
                continue;
            }

            if (!this.hasCapability(capability)) {
                this.log(`Adding capability ${capability} for endpoint ${endpointId}`);
                await this.addCapability(capability).catch(this.error);
            }
            this.registerCapability(capability, CLUSTER.ON_OFF, {
                endpoint: endpointId,
                // Custom set: returns the cluster command name and side-effects
                // a window during which we ignore the resulting attribute
                // report from this endpoint, so click only fires on physical
                // rocker presses — not on Homey-initiated commands.
                set: (value) => {
                    this._ignoreReportUntil[endpointId] = Date.now() + 2000;
                    return value ? 'setOn' : 'setOff';
                },
                setParser: () => ({}),
            });

            // Bind onOff toggle so we can trigger flows on physical rocker
            // presses (including when relay is detached).
            const endpoint = zclNode.endpoints[endpointId];
            if (endpoint) {
                endpoint.bind(CLUSTER.ON_OFF.NAME, new ZBM5OnOffBoundCluster(this, endpointId));
                // Also listen for onOff attribute reports — these fire whenever
                // the rocker toggles the relay in normal (non-detached) mode.
                // The default registerCapability handler only watches endpoint 1,
                // so we have to update onoff.l2/onoff.l3 manually here.
                endpoint.clusters.onOff.on('attr.onOff',
                    (value) => this._onOnOffReport(endpointId, capability, value));
            }
        }

        this.checkAttributes();
    }

    _onOnOffReport(endpointId, capability, value) {
        // Keep capability value in sync with the device state. The framework's
        // built-in onoff handler only reads endpoint 1, so we mirror reports
        // from endpoints 2 and 3 onto onoff.l2 / onoff.l3 ourselves.
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

    _channelCountFromProductId(productId) {
        const m = /ZBM5-(\d)C-/i.exec(productId);
        if (m) return Math.min(3, Math.max(1, parseInt(m[1], 10)));
        // Fallback: assume 1 channel if productId is missing or malformed.
        return 1;
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

        if (changedKeys.includes('device_work_mode')) {
            sonoffData.device_work_mode = Number(newSettings.device_work_mode);
        }

        if (changedKeys.some(k => k.startsWith('detach_relay_l'))) {
            // ZBM5 uses detach_relay_mode2 (0x0019, BITMAP8). zigbee2mqtt
            // sends this as a plain integer mask without manufacturer-specific
            // framing; the map8 encoder in zigbee-clusters accepts an integer
            // and writes it as a 1-byte BITMAP8. Currently still failing with
            // MALFORMED_COMMAND on Homey — kept as experimental setting.
            sonoffData.detach_relay_mode2 =
                (newSettings.detach_relay_l1 ? 0x01 : 0) |
                (newSettings.detach_relay_l2 ? 0x02 : 0) |
                (newSettings.detach_relay_l3 ? 0x04 : 0);
        }

        if (Object.keys(sonoffData).length > 0) {
            try {
                this.log('ZBM5 writing attributes:', JSON.stringify(sonoffData));
                await this.zclNode.endpoints[1].clusters[SonoffCluster.NAME].writeAttributes(sonoffData);
                this.log('ZBM5 write OK');
            } catch (err) {
                this.error('ZBM5 write FAILED:', err && err.message ? err.message : err);
            }
        }
    }

    async checkAttributes() {
        this.readAttribute(SonoffCluster, ['device_work_mode', 'detach_relay_mode2'], (data) => {
            const settingsUpdate = {};
            if (data.device_work_mode !== undefined) {
                settingsUpdate.device_work_mode = String(data.device_work_mode);
            }
            // detach_relay_mode2 comes back as a Bitmap object with l1/l2/l3 bits.
            if (data.detach_relay_mode2 !== undefined && data.detach_relay_mode2 !== null) {
                const m = data.detach_relay_mode2;
                settingsUpdate.detach_relay_l1 = !!m.l1;
                settingsUpdate.detach_relay_l2 = !!m.l2;
                settingsUpdate.detach_relay_l3 = !!m.l3;
            }
            if (Object.keys(settingsUpdate).length > 0) {
                this.setSettings(settingsUpdate).catch(this.error);
            }
        });
    }
}

module.exports = SonoffZBM5;
