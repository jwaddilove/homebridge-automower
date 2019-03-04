var Service, Characteristic;
var AutoMowerAPI = require('./autoMowerAPI.js').AutoMowerAPI;

const AutoMowerTools = require('./autoMowerTools.js');

function myAutoMowerPlatform(log, config, api) {
  this.log = log;
  this.login = config['email'];
  this.password = config['password'];
  this.refreshTimer = AutoMowerTools.checkTimer(config['refreshTimer']);

  this.foundAccessories = [];
  this.autoMowerAPI = new AutoMowerAPI(log, this);

  if (api) {
    // Save the API object as plugin needs to register new accessory via this object
    this.api = api;
  }
}

module.exports = function(homebridge) {
  Service = homebridge.hap.Service;
  Characteristic = homebridge.hap.Characteristic;
  homebridge.registerPlatform(
    'homebridge-automower',
    'HomebridgeAutomower',
    myAutoMowerPlatform
  );
};

myAutoMowerPlatform.prototype = {
  accessories: function(callback) {
    this.autoMowerAPI.authenticate(error => {
      if (error) {
        this.log.debug('ERROR - authenticating - ' + error);
        callback(undefined);
      } else {
        this.autoMowerAPI.getMowers(result => {
          if (result && result instanceof Array && result.length > 0) {
            for (let s = 0; s < result.length; s++) {
              this.log.debug('Mower : ' + JSON.stringify(result[s]));
              let services = [];
              let mowerName = result[s].name;
              let mowerModel = result[s].model;
              let mowerSeriaNumber = result[s].id;

              let batteryService = {
                controlService: new Service.BatteryService(mowerName),
                characteristics: [
                  Characteristic.ChargingState,
                  Characteristic.StatusLowBattery,
                  Characteristic.BatteryLevel,
                ],
              };
              batteryService.controlService.subtype = mowerName;
              batteryService.controlService.id = result[s].id;
              services.push(batteryService);

              let fanService = {
                controlService: new Service.Fan(mowerName + ' Mowing'),
                characteristics: [Characteristic.On],
              };
              fanService.controlService.subtype = mowerName + ' Mowing';
              fanService.controlService.id = result[s].id;
              services.push(fanService);

              let switchService = {
                controlService: new Service.Switch(mowerName + ' Auto/Park'),
                characteristics: [Characteristic.On],
              };
              switchService.controlService.subtype = mowerName + ' Auto/Park';
              switchService.controlService.id = result[s].id;
              services.push(switchService);

              let myMowerAccessory = new AutoMowerTools.AutoMowerAccessory(
                services
              );
              myMowerAccessory.getServices = function() {
                return this.platform.getServices(myMowerAccessory);
              };
              myMowerAccessory.platform = this;
              myMowerAccessory.name = mowerName;
              myMowerAccessory.model = mowerModel;
              myMowerAccessory.manufacturer = 'Husqvarna Group';
              myMowerAccessory.serialNumber = mowerSeriaNumber;
              myMowerAccessory.mowerID = mowerSeriaNumber;
              this.foundAccessories.push(myMowerAccessory);
            }

            //timer for background refresh
            this.refreshBackground();

            callback(this.foundAccessories);
          } else {
            //prevent homebridge from starting since we don't want to loose our doors.
            this.log.debug('ERROR - gettingMowers - ' + error);
            callback(undefined);
          }
        });
      }
    });
  },

  getBatteryLevelCharacteristic: function(homebridgeAccessory, callback) {
    this.log.debug('INFO - getBatteryLevelCharacteristic');
    var percent = 0;
    this.autoMowerAPI.authenticate(error => {
      if (error) {
        callback(undefined, percent);
      } else {
        this.autoMowerAPI.getMowers(result => {
          if (result && result instanceof Array && result.length > 0) {
            for (let s = 0; s < result.length; s++) {
              this.autoMowerAPI.logResult(result[s]);
              if (result[s].id === homebridgeAccessory.mowerID) {
                percent = result[s].status.batteryPercent;
                break;
              }
            }
          }
          callback(undefined, percent);
        });
      }
    });
  },
  getChargingStateCharacteristic: function(homebridgeAccessory, callback) {
    this.log.debug('INFO - getChargingStateCharacteristic');
    var charging = 0;

    this.autoMowerAPI.authenticate(error => {
      if (error) {
        callback(undefined, charging);
      } else
        this.autoMowerAPI.getMowers(result => {
          if (result && result instanceof Array && result.length > 0) {
            for (let s = 0; s < result.length; s++) {
              this.autoMowerAPI.logResult(result[s]);
              if (
                result[s].id === homebridgeAccessory.mowerID &&
                result[s].status &&
                result[s].status.connected &&
                (result[s].batteryPercent < 100 ||
                  result[s].status.mowerStatus.activity.startsWith('CHARGING'))
              ) {
                charging = 1;
                break;
              }
            }
          }
          callback(undefined, charging);
        });
    });
  },
  getLowBatteryCharacteristic: function(homebridgeAccessory, callback) {
    this.log.debug('INFO - getLowBatteryCharacteristic');
    var lowww = 0;
    this.autoMowerAPI.authenticate(error => {
      if (error) {
        callback(undefined, lowww);
      } else
        this.autoMowerAPI.getMowers(result => {
          if (result && result instanceof Array && result.length > 0) {
            for (let s = 0; s < result.length; s++) {
              this.autoMowerAPI.logResult(result[s]);
              if (
                result[s].id === homebridgeAccessory.mowerID &&
                result[s].status &&
                result[s].batteryPercent < 20
              ) {
                lowww = 1;
                break;
              }
            }
          }
          callback(undefined, lowww);
        });
    });
  },
  getSwitchOnCharacteristic: function(homebridgeAccessory, callback) {
    this.log.debug('INFO - getSwitchOnCharacteristic');
    var onn = false;
    this.autoMowerAPI.authenticate(error => {
      if (error) {
        callback(undefined, onn);
      } else
        this.autoMowerAPI.getMowers(result => {
          if (result && result instanceof Array && result.length > 0) {
            for (let s = 0; s < result.length; s++) {
              this.autoMowerAPI.logResult(result[s]);

              if (
                result[s].id === homebridgeAccessory.mowerID &&
                result[s].status &&
                result[s].status.mowerStatus.state.startsWith('IN_OPERATION')
              ) {
                onn = true;
                break;
              }
            }
          }
          callback(undefined, onn);
        });
    });
  },
  setSwitchOnCharacteristic: function(
    homebridgeAccessory,
    characteristic,
    value,
    callback
  ) {
    this.log.debug('INFO - setSwitchOnCharacteristic - ' + value);

    var commandURL;
    if (value) {
      //startMainArea
      commandURL =
        this.trackApiUrl +
        'mowers/' +
        homebridgeAccessory.mowerID +
        '/control/start/';
    } else {
      //park parkUntilNextStart
      commandURL =
        this.trackApiUrl +
        'mowers/' +
        homebridgeAccessory.mowerID +
        '/control/park/duration/timer';
    }

    var currentValue = characteristic.value;

    var that = this;
    this.autoMowerAPI.authenticate(error => {
      if (error) {
        setTimeout(function() {
          characteristic.updateValue(currentValue);
        }, 200);
        callback(error);
      } else {
        request(
          {
            url: commandURL,
            method: 'POST',
            headers: that.headers,
            json: true,
          },
          function(error, response, body) {
            that.log.debug('INFO - Command sent : ' + commandURL);
            that.log.debug('INFO - Body received : ' + body);
            if (error) {
              that.log(error.message);
              setTimeout(function() {
                characteristic.updateValue(currentValue);
              }, 200);
              callback(error);
            } else if (response && response.statusCode !== 200) {
              that.log('ERROR - No 200 return ' + response.statusCode);
              setTimeout(function() {
                characteristic.updateValue(currentValue);
              }, 200);
              callback(error);
            } else {
              callback();
            }
          }
        );
      }
    });
  },
  getMowerOnCharacteristic: function(homebridgeAccessory, callback) {
    this.log.debug('getMowerOnCharacteristic');

    var mowing = 0;
    this.autoMowerAPI.authenticate(error => {
      if (error) {
        callback(undefined, mowing);
      } else
        this.autoMowerAPI.getMowers(result => {
          this.log.debug('INFO - mowers result : ' + JSON.stringify(result));
          if (result && result instanceof Array && result.length > 0) {
            for (let s = 0; s < result.length; s++) {
              this.autoMowerAPI.logResult(result[s]);
              if (
                result[s].id === homebridgeAccessory.mowerID &&
                result[s].status &&
                result[s].status.mowerStatus.activity.startsWith('MOWING')
              ) {
                mowing = 1;
                break;
              }
            }
          }
          callback(undefined, mowing);
        });
    });
  },
  setMowerOnCharacteristic: function(
    homebridgeAccessory,
    characteristic,
    value,
    callback
  ) {
    this.log.debug('setMowerOnCharacteristic -' + value);

    var commandURL;
    if (value) {
      //startMainArea
      commandURL =
        this.trackApiUrl +
        'mowers/' +
        homebridgeAccessory.mowerID +
        '/control/start/';
    } else {
      //pause
      commandURL =
        this.trackApiUrl +
        'mowers/' +
        homebridgeAccessory.mowerID +
        '/control/pause';
    }

    var that = this;
    var currentValue = characteristic.value;
    that.log('current value' + currentValue);

    this.autoMowerAPI.authenticate(error => {
      if (error) {
        setTimeout(function() {
          characteristic.updateValue(currentValue);
        }, 200);
        callback(error);
      } else {
        request(
          {
            url: commandURL,
            method: 'POST',
            headers: that.headers,
            json: true,
          },
          function(error, response, body) {
            that.log.debug('INFO - Command sent' + commandURL);
            that.log.debug('INFO - body received' + body);
            if (error) {
              that.log(error.message);

              setTimeout(function() {
                characteristic.updateValue(currentValue);
              }, 200);

              callback(error);
            } else if (response && response.statusCode !== 200) {
              that.log('ERROR - No 200 return ' + response.statusCode);

              setTimeout(function() {
                characteristic.updateValue(currentValue);
              }, 200);

              callback(error);
            } else {
              callback();
            }
          }
        );
      }
    });
  },

  bindCharacteristicEvents: function(
    characteristic,
    service,
    homebridgeAccessory
  ) {
    if (characteristic instanceof Characteristic.BatteryLevel) {
      characteristic.on(
        'get',
        function(callback) {
          homebridgeAccessory.platform.getBatteryLevelCharacteristic(
            homebridgeAccessory,
            callback
          );
        }.bind(this)
      );
    } else if (characteristic instanceof Characteristic.ChargingState) {
      characteristic.on(
        'get',
        function(callback) {
          homebridgeAccessory.platform.getChargingStateCharacteristic(
            homebridgeAccessory,
            callback
          );
        }.bind(this)
      );
    } else if (characteristic instanceof Characteristic.StatusLowBattery) {
      characteristic.on(
        'get',
        function(callback) {
          homebridgeAccessory.platform.getLowBatteryCharacteristic(
            homebridgeAccessory,
            callback
          );
        }.bind(this)
      );
    } else if (
      characteristic instanceof Characteristic.On &&
      service.controlService instanceof Service.Switch
    ) {
      characteristic.on(
        'get',
        function(callback) {
          homebridgeAccessory.platform.getSwitchOnCharacteristic(
            homebridgeAccessory,
            callback
          );
        }.bind(this)
      );

      characteristic.on(
        'set',
        function(value, callback) {
          homebridgeAccessory.platform.setSwitchOnCharacteristic(
            homebridgeAccessory,
            characteristic,
            value,
            callback
          );
        }.bind(this)
      );
    } else if (
      characteristic instanceof Characteristic.On &&
      service.controlService instanceof Service.Fan
    ) {
      characteristic.on(
        'get',
        function(callback) {
          homebridgeAccessory.platform.getMowerOnCharacteristic(
            homebridgeAccessory,
            callback
          );
        }.bind(this)
      );

      characteristic.on(
        'set',
        function(value, callback) {
          homebridgeAccessory.platform.setMowerOnCharacteristic(
            homebridgeAccessory,
            characteristic,
            value,
            callback
          );
        }.bind(this)
      );
    }
  },

  refreshBackground() {
    //timer for background refresh
    if (this.refreshTimer !== undefined && this.refreshTimer > 0) {
      this.log.debug(
        'INFO - Setting Timer for background refresh every  : ' +
          this.refreshTimer +
          's'
      );
      this.timerID = setInterval(
        () => this.refreshAllMowers(),
        this.refreshTimer * 1000
      );
    }
  },

  getInformationService: function(homebridgeAccessory) {
    let informationService = new Service.AccessoryInformation();
    informationService
      .setCharacteristic(Characteristic.Name, homebridgeAccessory.name)
      .setCharacteristic(
        Characteristic.Manufacturer,
        homebridgeAccessory.manufacturer
      )
      .setCharacteristic(Characteristic.Model, homebridgeAccessory.model)
      .setCharacteristic(
        Characteristic.SerialNumber,
        homebridgeAccessory.serialNumber
      );
    return informationService;
  },

  getServices: function(homebridgeAccessory) {
    let services = [];
    let informationService = homebridgeAccessory.platform.getInformationService(
      homebridgeAccessory
    );
    services.push(informationService);
    for (let s = 0; s < homebridgeAccessory.services.length; s++) {
      let service = homebridgeAccessory.services[s];
      for (let i = 0; i < service.characteristics.length; i++) {
        let characteristic = service.controlService.getCharacteristic(
          service.characteristics[i]
        );
        if (characteristic == undefined)
          characteristic = service.controlService.addCharacteristic(
            service.characteristics[i]
          );

        homebridgeAccessory.platform.bindCharacteristicEvents(
          characteristic,
          service,
          homebridgeAccessory
        );
      }
      services.push(service.controlService);
    }
    return services;
  },
};
