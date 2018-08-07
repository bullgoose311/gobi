var express = require('express');
var bodyParser = require('body-parser');
var uuid = require('uuid');
var childProcess = require('child_process');
var request = require('request');

var app = express();
app.use(bodyParser.json());

var kProcessPath = process.env.GAME_SERVER_PROCESS_PATH;
var kMaxProcessCount = 3; //process.env.MAX_PROCESS_COUNT;
var kListenPort = process.env.LSPM_LISTEN_PORT;
var kVMId = process.env.VM_ID;
var kVMMEndpoint = process.env.VMM_ENDPOINT;

var kMaxStartingHeartbeatAge = 20000;
var kMaxRunningHeartbeatAge = 10000;
var kHeartbeatCheckInterval = 5000;
var kSendHeartbeatInterval = 5000;

var eMachineState =
{
    empty: 'empty',
    partial: 'partial',
    full: 'full',
    shuttingDown: 'shuttingDown',
};

var eProcessState = 
{
    starting: 'starting',
    running: 'running'
};

var gProcesses = {};
var gProcessCount = 0;
var gMachineState = eMachineState.empty;
var gSequenceIndex = 0;

app.get('/processes/:processId', (req, res) => {
    var processId = req.params.processId;
    var process = gProcesses[processId];
    if (process)
    {
        res.send(
            {
                params: process.params,
                state: process.state,
                lastHeartbeat: process.lastHeartbeat
            }
        );
    }
    else
    {
        res.sendStatus(404);
    }
});

app.post('/processes/', (req, res) => {
    // NOTE: We're modifying global state without having to lock it because new Node event model is single threaded

    if (gMachineState === eMachineState.full || gMachineState === eMachineState.shuttingDown)
    {
        res.status(409).send(
            {
                machineState: gMachineState,
                sequenceIndex: ++gSequenceIndex
            }
        );
    }
    else
    {
        var processId = uuid.v1();
        var params = req.body.params;

        // Note that these are child processes, so no need to clean them up when LSPM exits

        // TODO: Need to pass the lobby ID from matchmaking, then once the server starts up it can talk to the matchmaking service
        var child = childProcess.spawn(
            kProcessPath,
            [
                '--processId', processId,
                '--lspmEndpoint', 'http://127.0.0.1:' + kListenPort,
                '--blocking', params.blocking
            ]
        );

        if (!child)
        {
            // TODO: What to do if we fail to spawn the process?
            console.log('failed to spawn process');
            res.sendStatus(500);
            return;
        }

        child.stdout.on('data', (data) => {
            console.log('stdout: ' + data);
        });
        child.stderr.on('data', (data) => {
            console.log('stderr: ' + data);
        });
        child.on('close', (code, signal) => {
            console.log('child terminated by signal ' + signal + ' code ' + code);

            --gProcessCount;
            var oldMachineState = gMachineState;
            gMachineState = gProcessCount > 0 ? eMachineState.partial : eMachineState.empty;
            if (oldMachineState !== gMachineState)
            {
                console.log('Machine state changed from ' + oldMachineState + ' to ' + gMachineState);
            }
            delete gProcesses[processId];
        });

        gProcesses[processId] = {
            child: child,
            params: params,
            state: eProcessState.starting,
            lastHeartbeat: (new Date()).getTime()
        };
        ++gProcessCount;
        var oldMachineState = gMachineState;
        gMachineState = gProcessCount === kMaxProcessCount ? eMachineState.full : eMachineState.partial;
        if (oldMachineState !== gMachineState)
        {
            console.log('Machine state changed from ' + oldMachineState + ' to ' + gMachineState);
        }
        res.status(200).send(
            {
                processId: processId,
                state: gMachineState,
                sequenceIndex: ++gSequenceIndex
            }
        );
    }
});

app.delete('/processes/:proccessId', (req, res) => {
    var processId = req.params.proccessId;
    console.log("attempting to kill process " + processId);
    var process = gProcesses[processId];
    if (process)
    {
        process.child.kill();
        res.sendStatus(201);
    }
    else
    {
        res.sendStatus(404);
    }
});

app.put('/processes/:processId/heartbeat', (req, res) => {
    var processId = req.params.processId;
    var process = gProcesses[processId];
    if (process)
    {
        process.lastHeartbeat = (new Date()).getTime();
        process.state = eProcessState.running;
        res.sendStatus(201);
    }
    else
    {
        res.sendStatus(404);
    }
});

app.put('/shutdown', (req, res) => {

    if (gMachineState === eMachineState.empty)
    {
        gMachineState = eMachineState.shuttingDown;
        res.sendStatus(201);
    }
    else
    {
        res.status(409).send(
            {
                state: gMachineState
            }
        );
    }
});

function checkHeartbeats()
{
    console.log('checking server process heartbeats...');
    var processesToKill = [];
    var currentTimestamp = (new Date()).getTime();
    for (processId in gProcesses)
    {
        var process = gProcesses[processId];
        var heartbeatAge = currentTimestamp - process.lastHeartbeat;
        var maxAge = process.state === eProcessState.starting ? kMaxStartingHeartbeatAge : kMaxRunningHeartbeatAge;
        if (heartbeatAge > maxAge)
        {
            console.log('process ' + processId + ' timed out with heartbeat age of ' + heartbeatAge);
            processesToKill.push(process.child);
        }
    }

    processesToKill.forEach((process) => {
        // TODO: What if the process is already dead?  Are we guaranteed that the "close" event will fire so that we clean up the array?
        process.kill();
    });
}

function sendHeartbeat()
{
    var options =
    {
        url: kVMMEndpoint + '/vms/' + kVMId + '/heartbeat',
        method: 'PUT',
        json: 
        {
            sequenceIndex: ++gSequenceIndex,
            state: gMachineState
        }
    };

    request(options, (error, response, body) => {
        if (error)
        {
            console.log('failed to send heartbeat: ' + error);
        }
        else
        {
            switch (response.statusCode)
            {
                case 201:
                    // Success
                    break;
                case 404: // TODO: If the process doesn't exist then the VMM should add it
                default:
                    console.log('failed to sendheartbeat, received http status code ' + response.statusCode);
                    break;
            }
        }
    });
}

setInterval(checkHeartbeats, kHeartbeatCheckInterval);
setInterval(sendHeartbeat, kSendHeartbeatInterval);

app.listen(kListenPort, () => {
    console.log('Local server process manager started on port ' + kListenPort);
});