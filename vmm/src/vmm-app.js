var s_constants = require('./vmm-constants');
var s_vmRepository = require('./repositories/vm-repository-local');
var s_cloudProvider = require('./cloud/cloud-provider-local');
var s_processesApi = require('./api/vmm-processes-api');
var s_types = require('./vmm-types');

var s_express = require('express');
var s_bodyParser = require('body-parser');
var s_request = require('request');

var s_app = s_express();
s_app.use(s_bodyParser.json());

s_app.post('/processes/', (req, res) => {
    var params = req.body.params;
    s_processesApi.spawnServerProcessAsync(params, (succeeded) => {
        if (succeeded)
        {
            res.sendStatus(201);
        }
        else
        {
            // TODO: Better status code to return here?
            res.sendStatus(500);
        }
    });
});

function shutdownVM(vm)
{
    s_vmRepository.changeState(vm, s_types.eMachineState.shuttingDown);
    s_cloudProvider.deprovisionVMAsync(vm.cloudProviderId, function(err) {
        if (err)
        {
            console.log('failed to deprovision vm ' + vm.id);
            // We'll try and kill it again later when it times out
        }
        else
        {
            s_vmRepository.remove(vm.id);
        }
    });
}

s_app.put('/vms/:vmId/heartbeat', (req, res) => {
    var vmId = req.params.vmId;
    var sequenceIndex = req.body.sequenceIndex;
    var newState = req.body.state;
    var vm = s_vmRepository.get(vmId);
    if (vm)
    {
        var oldState = vm.state;
        res.sendStatus(201); // send status right away so lspm can close connection

        // TODO: When do we transition out of pending state?
        if (oldState !== s_types.eMachineState.pending && oldState !== s_types.eMachineState.shuttingDown && sequenceIndex > vm.lastSequenceIndex)
        {
            vm.lastHeartbeat = (new Date()).getTime();
            vm.lastSequenceIndex = sequenceIndex;
            if (newState === s_types.eMachineState.empty)
            {
                // TODO: Instead of immediately shutting down VMs that are empty we should give them some cool down time
                // based on previous history

                var options = 
                {
                    url: vm.lspmEndpoint + '/shutdown',
                    method: 'PUT'
                };

                s_request(options, (error, response, body) => {
                    if (error)
                    {
                        console.log(error);
                        // This lspm will timeout again later...
                    }
                    else
                    {
                        switch (response.statusCode)
                        {
                            case 201:
                                shutdownVM(vm);
                                break;
                            case 409:
                                console.log('shutdown handshake failed, vm in state ' + body.state);
                                s_vmRepository.changeState(vm, body.state);
                                break;
                            default:
                                console.log('unrecognized status code ' + response.statusCode);
                                break;
                        }
                    }
                });
            }
            else
            {
                s_vmRepository.changeState(vm, newState);
            }
        }
    }
    else
    {
        // TODO: Instead of returning a 404, why not just add it to the list of VMs?  This way existing VMs will auto-register
        // with new VMMs that are spun up

        res.sendStatus(404);
    }
});

function checkHeartbeats()
{
    console.log('checking VM heartbeats...');
    var vmsToKill = [];
    var currentTimestamp = (new Date()).getTime();
    for (vmId in s_vmRepository.getAll())
    {
        var vm = s_vmRepository.get(vmId);
        var hearbeatAge = currentTimestamp - vm.lastHeartbeat;
        if (hearbeatAge > s_constants.kMaxRunningHeartbeatAge && vm.state !== s_types.eMachineState.pending)
        {
            vmsToKill.push(vm);
        }
    }
    // There is something wrong with the lspm, so no need to handshake
    vmsToKill.forEach(shutdownVM);
}

setInterval(checkHeartbeats, s_constants.kHeartbeatCheckInterval);

s_app.listen(s_constants.kListenPort, () => {
    console.log('Virtual machine manager started on port ' + s_constants.kListenPort);
});