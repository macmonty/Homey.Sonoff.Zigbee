"use strict";

const Homey = require("homey");

/*if (process.env.DEBUGPRO === "1") {
   const inspector = require('inspector');
   inspector.close();
   inspector.open(9331, '0.0.0.0', true);
}*/

if (process.env.DEBUG === "1X") {
  const inspector = require('inspector');
  if (!inspector.url()) {
    inspector.open(9330, '0.0.0.0', true);
  }
  inspector.waitForDebugger();
}

class SonoffZigbeeApp extends Homey.App {
  onInit() {
    this.log("Sonoff Zigbee - StyraHem, initiating...");
    
    // Register flow condition handlers
    this.homey.flow.getConditionCard('measure_temperature_compare')
      .registerRunListener(async (args, state) => {
        const device = args.device;
        const targetTemperature = args.temperature;
        
        if (!device.hasCapability('measure_temperature')) {
          throw new Error('Device does not have temperature measurement capability');
        }
        
        const currentTemperature = device.getCapabilityValue('measure_temperature');
        
        if (currentTemperature === null || currentTemperature === undefined) {
          throw new Error('Unable to get current temperature from device');
        }
        
        return currentTemperature > targetTemperature;
      });
      
    this.homey.flow.getConditionCard('measure_humidity_compare')
      .registerRunListener(async (args, state) => {
        const device = args.device;
        const targetHumidity = args.humidity;
        
        if (!device.hasCapability('measure_humidity')) {
          throw new Error('Device does not have humidity measurement capability');
        }
        
        const currentHumidity = device.getCapabilityValue('measure_humidity');
        
        if (currentHumidity === null || currentHumidity === undefined) {
          throw new Error('Unable to get current humidity from device');
        }
        
        return currentHumidity > targetHumidity;
      });
      
    this.homey.flow.getConditionCard('sonoff_illuminance')
      .registerRunListener(async (args, state) => {
        const device = args.device;
        
        if (!device.hasCapability('sonoff_illuminance')) {
          throw new Error('Device does not have illuminance capability');
        }
        
        const illuminanceState = device.getCapabilityValue('sonoff_illuminance');
        
        if (illuminanceState === null || illuminanceState === undefined) {
          throw new Error('Unable to get illuminance state from device');
        }
        
        // The condition returns true when the state matches the selection
        // args.higher is true for "bright", false for "dim"
        const isBright = illuminanceState === 'bright';
        return isBright === args.higher;
      });
  }
}

module.exports = SonoffZigbeeApp;
