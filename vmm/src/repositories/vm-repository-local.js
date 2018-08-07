var s_types = require('../vmm-types');

var gVMs = {};
var gAvailableVMs = {};

// TODO: Make these APIs async
module.exports = {
    
    add(vm)
    {
        gVMs[vm.id] = vm;
    },

    getAll()
    {
        return gVMs; // TODO: Can we make this immutable?
    },

    get(vmId)
    {
        return gVMs[vmId];
    },

    getNextAvailable()
    {
        for (var vmId in gAvailableVMs)
        {
            return gAvailableVMs[vmId];
        }

        return null;
    },

    changeState(vm, newState)
    {
        // This is the only function that should be used to update the state of a VM as it's the only place where
        // we insert into the gAvailableVMs map

        if (vm.state === newState)
        {
            return;
        }

        console.log('vm ' + vm.id + ' changing state from ' + vm.state + ' to ' + newState);

        if (vm.state === s_types.eMachineState.partial)
        {
            delete gAvailableVMs[vm.id];
        }
        vm.state = newState;
        if (newState === s_types.eMachineState.partial)
        {
            gAvailableVMs[vm.id] = vm;
        }
    },

    remove(vmId)
    {
        delete gVMs[vmId];
        delete gAvailableVMs[vmId];
    }
}