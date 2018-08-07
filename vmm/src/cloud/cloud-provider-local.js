var s_constants = require('../vmm-constants')

var s_childProcess = require('child_process');
var s_uuid = require('uuid');

var gLspms = {};

var gNextLspmListenPort = 4000;

module.exports = {

    provisionVMAsync: function(vmId, callback) {
        var lspmListenPort = gNextLspmListenPort++;

        var child = s_childProcess.spawn(
            'node',
            [
                'D:\\TRS_Perforce_TRSPlatform\\atuin\\src\\lspm\\src\\lspm-app.js'
            ],
            {
                env: 
                {
                    VM_ID : vmId,
                    LSPM_LISTEN_PORT: lspmListenPort,
                    VMM_ENDPOINT: 'http://127.0.0.1:' + s_constants.kListenPort,
                    GAME_SERVER_PROCESS_PATH: 'D:\\TRS_Perforce_TRSPlatform\\atuin\\bin\\gobi-test.exe'
                }
            }
        );

        if (child)
        {
            var id = s_uuid.v1();

            gLspms[id] = child;

            child.stdout.on('data', (data) => {
                console.log('lspm(' + id + ') stdout: ' + data);
            });
            child.stderr.on('data', (data) => {
                console.log('lspm(' + id + ') stderr: ' + data);
            });

            callback(
                null, 
                {
                    lspmEndpoint: 'http://127.0.0.1:' + lspmListenPort,
                    id: id
                }
            );
        }
        else
        {
            callback('failed to spawn child process', null);
        }
    },
    
    deprovisionVMAsync: function(cloudProviderId, callback) {
        var child = gLspms[cloudProviderId];
        if (child)
        {
            child.kill();
            delete gLspms[cloudProviderId];
        }
        callback(null);
    }
}