/* Interface
module.exports = {
    provisionVMAsync: function(vmId, callback),
    deprovisionVMAsync: function(cloudProviderId, callback)
}
*/

module.exports = {
    
    provisionVMAsync: function(vmId, callback)
    {
        callback('aws not implemented!', null);
    },

    deprovisionVMAsync: function(cloudProviderId, callback)
    {
        callback('aws not implemented!', null);
    }
}