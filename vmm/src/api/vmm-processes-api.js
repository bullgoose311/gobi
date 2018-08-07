var s_vmRepository = require('../repositories/vm-repository-local');
var s_cloudProvider = require('../cloud/cloud-provider-local');
var s_types = require('../vmm-types');

var s_uuid = require('uuid');
var s_async = require('async');
var s_request = require('request');

module.exports = {

    spawnServerProcessAsync: function(params, callback) {
        var vm = s_vmRepository.getNextAvailable();
        s_async.series(
            [
                // Provision a VM if needed
                function(seriesCallback)
                {   
                    if (!vm)
                    {
                        var vmId = s_uuid.v1();
                        s_cloudProvider.provisionVMAsync(vmId, (err, cloudProviderResponse) => {
                            if (err)
                            {
                                seriesCallback(err);
                            }
                            else
                            {
                                vm = 
                                {
                                    state: s_types.eMachineState.pending,
                                    id: vmId,
                                    lspmEndpoint: cloudProviderResponse.lspmEndpoint,
                                    lastHeartbeat: (new Date()).getTime(),
                                    lastSequenceIndex: 0,
                                    cloudProviderId: cloudProviderResponse.id
                                };
                                s_vmRepository.add(vm);
                                seriesCallback(null);
                            }
                        });
                    }
                    else
                    {
                        s_vmRepository.changeState(vm, s_types.eMachineState.pending);
                        seriesCallback(null);
                    }
                },
                // VM is now in the pending state so no other requests / threads can use it while we are
                function(seriesCallback)
                {
                    var options =
                    {
                        url: vm.lspmEndpoint + '/processes/',
                        method: 'POST',
                        json: 
                        {
                            params: params
                        }
                    };

                    s_request(options, (error, response, body) => {
                        if (error)
                        {
                            seriesCallback(error);
                        }
                        else if (response.statusCode == 200)
                        {
                            if (body.sequenceIndex > vm.lastSequenceIndex)
                            {
                                console.log('successfully spawned process ' + body.processId + ' on VM ' + vm.id);
                                vm.lastSequenceIndex = body.sequenceIndex;
                                s_vmRepository.changeState(vm, body.state);
                                seriesCallback(null);
                            }
                            else
                            {
                                seriesCallback('invalid sequence number ' + body.sequenceNumber);
                            }
                        }
                        else
                        {
                            seriesCallback(response.statusCode);
                        }
                    });
                }
            ],
            function(err)
            {
                if (err)
                {
                    console.log(err);

                    if (vm)
                    {
                        // In the case of an error we need to switch the VM's state from pending to unknown
                        s_vmRepository.changeState(vm, s_types.eMachineState.recentLaunchUnknown);
                    }
                    
                    // TODO: Error handling
                    // HTTP 409: Either the machine was shutting down or is full
                    // Cloud provider could have lots of errors
                    // Invalid sequence number

                    callback(false);
                }
                else
                {
                    callback(true);
                }
            }
        );
    }

};