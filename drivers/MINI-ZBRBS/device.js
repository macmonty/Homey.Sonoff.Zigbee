'use strict';

const SonoffBase = require('../sonoffbase');
const { Cluster, CLUSTER } = require('zigbee-clusters');
const SonoffCluster = require('../../lib/SonoffCluster');
const { writeAttributesVerbose } = require('../../lib/zclDebug');

Cluster.addCluster(SonoffCluster);

const CALIBRATION_ACTION_VALUES = {
    none: null,
    start_automatic: 2,
    start_manual: 3,
    clear: 4,
    manual_2_fully_opened: 7,
    manual_3_fully_closed: 8,
};

class SonoffMINIZBRBS extends SonoffBase {

    async onNodeInit({ zclNode }) {
        super.onNodeInit({ zclNode });

        this.log('MINI-ZBRBS init');

        this.registerCapability('windowcoverings_state', CLUSTER.WINDOW_COVERING);

        this.registerCapability('windowcoverings_set', CLUSTER.WINDOW_COVERING, {
            set: 'goToLiftPercentage',
            report: 'currentPositionLiftPercentage',
            setParser(value) {
                return { percentageLiftValue: Math.round(value * 100) };
            },
            reportParser(value) {
                return value / 100;
            },
        });
    }

    async onSettings({ oldSettings, newSettings, changedKeys }) {
        if (changedKeys.includes('motor_travel_calibration_action')) {
            const choice = newSettings.motor_travel_calibration_action;
            const code = CALIBRATION_ACTION_VALUES[choice];
            if (code !== null && code !== undefined) {
                try {
                    this.log('Writing motor_travel_calibration_action =', choice, '(' + code + ')');
                    await writeAttributesVerbose(this, this.zclNode.endpoints[1].clusters[SonoffCluster.NAME], {
                        motor_travel_calibration_action: code,
                    });
                    this.log('Calibration action sent');
                } catch (err) {
                    this.error('Failed to send calibration action:', err && err.message ? err.message : err);
                }
            }
            // Reset the setting back to 'none' so the user can re-trigger the same action later.
            setImmediate(() => {
                this.setSettings({ motor_travel_calibration_action: 'none' }).catch(this.error);
            });
        }
    }

    async onDeleted() {
        this.log('MINI-ZBRBS removed');
    }
}

module.exports = SonoffMINIZBRBS;
