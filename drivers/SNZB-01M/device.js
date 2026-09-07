'use strict';

const SonoffBase = require('../sonoffbase');
const { Cluster } = require('zigbee-clusters');
const SonoffCluster2 = require('../../lib/SonoffCluster2');

Cluster.addCluster(SonoffCluster2);

const ACTION_MAP = {
    1: 'single',
    2: 'double',
    3: 'long',
    4: 'triple',
};

class SonoffSNZB01M extends SonoffBase {

    async onNodeInit({ zclNode }) {
        super.onNodeInit({ zclNode });

        const prefix = this.driver.id + ':';
        this._buttonAction = this.homey.flow.getDeviceTriggerCard(prefix + 'button_action');

        for (const endpointId of [1, 2, 3, 4]) {
            const endpoint = zclNode.endpoints[endpointId];
            if (!endpoint || !endpoint.clusters[SonoffCluster2.NAME]) {
                this.log('Endpoint', endpointId, 'missing SonoffCluster2, skipping');
                continue;
            }
            endpoint.clusters[SonoffCluster2.NAME]
                .on('attr.keyActionEvent', value => this._onKeyAction(endpointId, value));
        }
    }

    _onKeyAction(buttonId, value) {
        const action = ACTION_MAP[value];
        if (!action) {
            this.log('Unknown keyActionEvent value', value, 'on button', buttonId);
            return;
        }
        this.log('Button', buttonId, 'action', action);

        const tokens = { button: String(buttonId), action };
        const state = { button: String(buttonId), action };
        this._buttonAction.trigger(this, tokens, state).catch(this.error);
    }
}

module.exports = SonoffSNZB01M;
