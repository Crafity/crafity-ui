/*
 * ----------------------------- JSTORAGE -------------------------------------
 * Simple local storage wrapper to save data on the browser side, supporting
 * all major browsers - IE6+, Firefox2+, Safari4+, Chrome4+ and Opera 10.5+
 *
 * Author: Andris Reinman, andris.reinman@gmail.com
 * Project homepage: www.jstorage.info
 *
 * Licensed under Unlicense:
 *
 * This is free and unencumbered software released into the public domain.
 * 
 * Anyone is free to copy, modify, publish, use, compile, sell, or
 * distribute this software, either in source code form or as a compiled
 * binary, for any purpose, commercial or non-commercial, and by any
 * means.
 * 
 * In jurisdictions that recognize copyright laws, the author or authors
 * of this software dedicate any and all copyright interest in the
 * software to the public domain. We make this dedication for the benefit
 * of the public at large and to the detriment of our heirs and
 * successors. We intend this dedication to be an overt act of
 * relinquishment in perpetuity of all present and future rights to this
 * software under copyright law.
 * 
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
 * EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
 * MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
 * IN NO EVENT SHALL THE AUTHORS BE LIABLE FOR ANY CLAIM, DAMAGES OR
 * OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE,
 * ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR
 * OTHER DEALINGS IN THE SOFTWARE.
 * 
 * For more information, please refer to <http://unlicense.org/>
 */

 (function(){
    var
        /* jStorage version */
        JSTORAGE_VERSION = "0.4.8",

        /* detect a dollar object or create one if not found */
        $ = window.jQuery || window.$ || (window.$ = {}),

        /* check for a JSON handling support */
        JSON = {
            parse:
                window.JSON && (window.JSON.parse || window.JSON.decode) ||
                String.prototype.evalJSON && function(str){return String(str).evalJSON();} ||
                $.parseJSON ||
                $.evalJSON,
            stringify:
                Object.toJSON ||
                window.JSON && (window.JSON.stringify || window.JSON.encode) ||
                $.toJSON
        };

    // Break if no JSON support was found
    if(!("parse" in JSON) || !("stringify" in JSON)){
        throw new Error("No JSON support found, include //cdnjs.cloudflare.com/ajax/libs/json2/20110223/json2.js to page");
    }

    var
        /* This is the object, that holds the cached values */
        _storage = {__jstorage_meta:{CRC32:{}}},

        /* Actual browser storage (localStorage or globalStorage["domain"]) */
        _storage_service = {jStorage:"{}"},

        /* DOM element for older IE versions, holds userData behavior */
        _storage_elm = null,

        /* How much space does the storage take */
        _storage_size = 0,

        /* which backend is currently used */
        _backend = false,

        /* onchange observers */
        _observers = {},

        /* timeout to wait after onchange event */
        _observer_timeout = false,

        /* last update time */
        _observer_update = 0,

        /* pubsub observers */
        _pubsub_observers = {},

        /* skip published items older than current timestamp */
        _pubsub_last = +new Date(),

        /* Next check for TTL */
        _ttl_timeout,

        /**
         * XML encoding and decoding as XML nodes can't be JSON'ized
         * XML nodes are encoded and decoded if the node is the value to be saved
         * but not if it's as a property of another object
         * Eg. -
         *   $.jStorage.set("key", xmlNode);        // IS OK
         *   $.jStorage.set("key", {xml: xmlNode}); // NOT OK
         */
        _XMLService = {

            /**
             * Validates a XML node to be XML
             * based on jQuery.isXML function
             */
            isXML: function(elm){
                var documentElement = (elm ? elm.ownerDocument || elm : 0).documentElement;
                return documentElement ? documentElement.nodeName !== "HTML" : false;
            },

            /**
             * Encodes a XML node to string
             * based on http://www.mercurytide.co.uk/news/article/issues-when-working-ajax/
             */
            encode: function(xmlNode) {
                if(!this.isXML(xmlNode)){
                    return false;
                }
                try{ // Mozilla, Webkit, Opera
                    return new XMLSerializer().serializeToString(xmlNode);
                }catch(E1) {
                    try {  // IE
                        return xmlNode.xml;
                    }catch(E2){}
                }
                return false;
            },

            /**
             * Decodes a XML node from string
             * loosely based on http://outwestmedia.com/jquery-plugins/xmldom/
             */
            decode: function(xmlString){
                var dom_parser = ("DOMParser" in window && (new DOMParser()).parseFromString) ||
                        (window.ActiveXObject && function(_xmlString) {
                    var xml_doc = new ActiveXObject("Microsoft.XMLDOM");
                    xml_doc.async = "false";
                    xml_doc.loadXML(_xmlString);
                    return xml_doc;
                }),
                resultXML;
                if(!dom_parser){
                    return false;
                }
                resultXML = dom_parser.call("DOMParser" in window && (new DOMParser()) || window, xmlString, "text/xml");
                return this.isXML(resultXML)?resultXML:false;
            }
        };


    ////////////////////////// PRIVATE METHODS ////////////////////////

    /**
     * Initialization function. Detects if the browser supports DOM Storage
     * or userData behavior and behaves accordingly.
     */
    function _init(){
        /* Check if browser supports localStorage */
        var localStorageReallyWorks = false;
        if("localStorage" in window){
            try {
                window.localStorage.setItem("_tmptest", "tmpval");
                localStorageReallyWorks = true;
                window.localStorage.removeItem("_tmptest");
            } catch(BogusQuotaExceededErrorOnIos5) {
                // Thanks be to iOS5 Private Browsing mode which throws
                // QUOTA_EXCEEDED_ERRROR DOM Exception 22.
            }
        }

        if(localStorageReallyWorks){
            try {
                if(window.localStorage) {
                    _storage_service = window.localStorage;
                    _backend = "localStorage";
                    _observer_update = _storage_service.jStorage_update;
                }
            } catch(E3) {/* Firefox fails when touching localStorage and cookies are disabled */}
        }
        /* Check if browser supports globalStorage */
        else if("globalStorage" in window){
            try {
                if(window.globalStorage) {
                    if(window.location.hostname == "localhost"){
                        _storage_service = window.globalStorage["localhost.localdomain"];
                    }
                    else{
                        _storage_service = window.globalStorage[window.location.hostname];
                    }
                    _backend = "globalStorage";
                    _observer_update = _storage_service.jStorage_update;
                }
            } catch(E4) {/* Firefox fails when touching localStorage and cookies are disabled */}
        }
        /* Check if browser supports userData behavior */
        else {
            _storage_elm = document.createElement("link");
            if(_storage_elm.addBehavior){

                /* Use a DOM element to act as userData storage */
                _storage_elm.style.behavior = "url(#default#userData)";

                /* userData element needs to be inserted into the DOM! */
                document.getElementsByTagName("head")[0].appendChild(_storage_elm);

                try{
                    _storage_elm.load("jStorage");
                }catch(E){
                    // try to reset cache
                    _storage_elm.setAttribute("jStorage", "{}");
                    _storage_elm.save("jStorage");
                    _storage_elm.load("jStorage");
                }

                var data = "{}";
                try{
                    data = _storage_elm.getAttribute("jStorage");
                }catch(E5){}

                try{
                    _observer_update = _storage_elm.getAttribute("jStorage_update");
                }catch(E6){}

                _storage_service.jStorage = data;
                _backend = "userDataBehavior";
            }else{
                _storage_elm = null;
                return;
            }
        }

        // Load data from storage
        _load_storage();

        // remove dead keys
        _handleTTL();

        // start listening for changes
        _setupObserver();

        // initialize publish-subscribe service
        _handlePubSub();

        // handle cached navigation
        if("addEventListener" in window){
            window.addEventListener("pageshow", function(event){
                if(event.persisted){
                    _storageObserver();
                }
            }, false);
        }
    }

    /**
     * Reload data from storage when needed
     */
    function _reloadData(){
        var data = "{}";

        if(_backend == "userDataBehavior"){
            _storage_elm.load("jStorage");

            try{
                data = _storage_elm.getAttribute("jStorage");
            }catch(E5){}

            try{
                _observer_update = _storage_elm.getAttribute("jStorage_update");
            }catch(E6){}

            _storage_service.jStorage = data;
        }

        _load_storage();

        // remove dead keys
        _handleTTL();

        _handlePubSub();
    }

    /**
     * Sets up a storage change observer
     */
    function _setupObserver(){
        if(_backend == "localStorage" || _backend == "globalStorage"){
            if("addEventListener" in window){
                window.addEventListener("storage", _storageObserver, false);
            }else{
                document.attachEvent("onstorage", _storageObserver);
            }
        }else if(_backend == "userDataBehavior"){
            setInterval(_storageObserver, 1000);
        }
    }

    /**
     * Fired on any kind of data change, needs to check if anything has
     * really been changed
     */
    function _storageObserver(){
        var updateTime;
        // cumulate change notifications with timeout
        clearTimeout(_observer_timeout);
        _observer_timeout = setTimeout(function(){

            if(_backend == "localStorage" || _backend == "globalStorage"){
                updateTime = _storage_service.jStorage_update;
            }else if(_backend == "userDataBehavior"){
                _storage_elm.load("jStorage");
                try{
                    updateTime = _storage_elm.getAttribute("jStorage_update");
                }catch(E5){}
            }

            if(updateTime && updateTime != _observer_update){
                _observer_update = updateTime;
                _checkUpdatedKeys();
            }

        }, 25);
    }

    /**
     * Reloads the data and checks if any keys are changed
     */
    function _checkUpdatedKeys(){
        var oldCrc32List = JSON.parse(JSON.stringify(_storage.__jstorage_meta.CRC32)),
            newCrc32List;

        _reloadData();
        newCrc32List = JSON.parse(JSON.stringify(_storage.__jstorage_meta.CRC32));

        var key,
            updated = [],
            removed = [];

        for(key in oldCrc32List){
            if(oldCrc32List.hasOwnProperty(key)){
                if(!newCrc32List[key]){
                    removed.push(key);
                    continue;
                }
                if(oldCrc32List[key] != newCrc32List[key] && String(oldCrc32List[key]).substr(0,2) == "2."){
                    updated.push(key);
                }
            }
        }

        for(key in newCrc32List){
            if(newCrc32List.hasOwnProperty(key)){
                if(!oldCrc32List[key]){
                    updated.push(key);
                }
            }
        }

        _fireObservers(updated, "updated");
        _fireObservers(removed, "deleted");
    }

    /**
     * Fires observers for updated keys
     *
     * @param {Array|String} keys Array of key names or a key
     * @param {String} action What happened with the value (updated, deleted, flushed)
     */
    function _fireObservers(keys, action){
        keys = [].concat(keys || []);
        if(action == "flushed"){
            keys = [];
            for(var key in _observers){
                if(_observers.hasOwnProperty(key)){
                    keys.push(key);
                }
            }
            action = "deleted";
        }
        for(var i=0, len = keys.length; i<len; i++){
            if(_observers[keys[i]]){
                for(var j=0, jlen = _observers[keys[i]].length; j<jlen; j++){
                    _observers[keys[i]][j](keys[i], action);
                }
            }
            if(_observers["*"]){
                for(var j=0, jlen = _observers["*"].length; j<jlen; j++){
                    _observers["*"][j](keys[i], action);
                }
            }
        }
    }

    /**
     * Publishes key change to listeners
     */
    function _publishChange(){
        var updateTime = (+new Date()).toString();

        if(_backend == "localStorage" || _backend == "globalStorage"){
            try {
                _storage_service.jStorage_update = updateTime;
            } catch (E8) {
                // safari private mode has been enabled after the jStorage initialization
                _backend = false;
            }
        }else if(_backend == "userDataBehavior"){
            _storage_elm.setAttribute("jStorage_update", updateTime);
            _storage_elm.save("jStorage");
        }

        _storageObserver();
    }

    /**
     * Loads the data from the storage based on the supported mechanism
     */
    function _load_storage(){
        /* if jStorage string is retrieved, then decode it */
        if(_storage_service.jStorage){
            try{
                _storage = JSON.parse(String(_storage_service.jStorage));
            }catch(E6){_storage_service.jStorage = "{}";}
        }else{
            _storage_service.jStorage = "{}";
        }
        _storage_size = _storage_service.jStorage?String(_storage_service.jStorage).length:0;

        if(!_storage.__jstorage_meta){
            _storage.__jstorage_meta = {};
        }
        if(!_storage.__jstorage_meta.CRC32){
            _storage.__jstorage_meta.CRC32 = {};
        }
    }

    /**
     * This functions provides the "save" mechanism to store the jStorage object
     */
    function _save(){
        _dropOldEvents(); // remove expired events
        try{
            _storage_service.jStorage = JSON.stringify(_storage);
            // If userData is used as the storage engine, additional
            if(_storage_elm) {
                _storage_elm.setAttribute("jStorage",_storage_service.jStorage);
                _storage_elm.save("jStorage");
            }
            _storage_size = _storage_service.jStorage?String(_storage_service.jStorage).length:0;
        }catch(E7){/* probably cache is full, nothing is saved this way*/}
    }

    /**
     * Function checks if a key is set and is string or numberic
     *
     * @param {String} key Key name
     */
    function _checkKey(key){
        if(typeof key != "string" && typeof key != "number"){
            throw new TypeError("Key name must be string or numeric");
        }
        if(key == "__jstorage_meta"){
            throw new TypeError("Reserved key name");
        }
        return true;
    }

    /**
     * Removes expired keys
     */
    function _handleTTL(){
        var curtime, i, TTL, CRC32, nextExpire = Infinity, changed = false, deleted = [];

        clearTimeout(_ttl_timeout);

        if(!_storage.__jstorage_meta || typeof _storage.__jstorage_meta.TTL != "object"){
            // nothing to do here
            return;
        }

        curtime = +new Date();
        TTL = _storage.__jstorage_meta.TTL;

        CRC32 = _storage.__jstorage_meta.CRC32;
        for(i in TTL){
            if(TTL.hasOwnProperty(i)){
                if(TTL[i] <= curtime){
                    delete TTL[i];
                    delete CRC32[i];
                    delete _storage[i];
                    changed = true;
                    deleted.push(i);
                }else if(TTL[i] < nextExpire){
                    nextExpire = TTL[i];
                }
            }
        }

        // set next check
        if(nextExpire != Infinity){
            _ttl_timeout = setTimeout(_handleTTL, nextExpire - curtime);
        }

        // save changes
        if(changed){
            _save();
            _publishChange();
            _fireObservers(deleted, "deleted");
        }
    }

    /**
     * Checks if there's any events on hold to be fired to listeners
     */
    function _handlePubSub(){
        var i, len;
        if(!_storage.__jstorage_meta.PubSub){
            return;
        }
        var pubelm,
            _pubsubCurrent = _pubsub_last;

        for(i=len=_storage.__jstorage_meta.PubSub.length-1; i>=0; i--){
            pubelm = _storage.__jstorage_meta.PubSub[i];
            if(pubelm[0] > _pubsub_last){
                _pubsubCurrent = pubelm[0];
                _fireSubscribers(pubelm[1], pubelm[2]);
            }
        }

        _pubsub_last = _pubsubCurrent;
    }

    /**
     * Fires all subscriber listeners for a pubsub channel
     *
     * @param {String} channel Channel name
     * @param {Mixed} payload Payload data to deliver
     */
    function _fireSubscribers(channel, payload){
        if(_pubsub_observers[channel]){
            for(var i=0, len = _pubsub_observers[channel].length; i<len; i++){
                // send immutable data that can't be modified by listeners
                try{
                    _pubsub_observers[channel][i](channel, JSON.parse(JSON.stringify(payload)));
                }catch(E){};
            }
        }
    }

    /**
     * Remove old events from the publish stream (at least 2sec old)
     */
    function _dropOldEvents(){
        if(!_storage.__jstorage_meta.PubSub){
            return;
        }

        var retire = +new Date() - 2000;

        for(var i=0, len = _storage.__jstorage_meta.PubSub.length; i<len; i++){
            if(_storage.__jstorage_meta.PubSub[i][0] <= retire){
                // deleteCount is needed for IE6
                _storage.__jstorage_meta.PubSub.splice(i, _storage.__jstorage_meta.PubSub.length - i);
                break;
            }
        }

        if(!_storage.__jstorage_meta.PubSub.length){
            delete _storage.__jstorage_meta.PubSub;
        }

    }

    /**
     * Publish payload to a channel
     *
     * @param {String} channel Channel name
     * @param {Mixed} payload Payload to send to the subscribers
     */
    function _publish(channel, payload){
        if(!_storage.__jstorage_meta){
            _storage.__jstorage_meta = {};
        }
        if(!_storage.__jstorage_meta.PubSub){
            _storage.__jstorage_meta.PubSub = [];
        }

        _storage.__jstorage_meta.PubSub.unshift([+new Date, channel, payload]);

        _save();
        _publishChange();
    }


    /**
     * JS Implementation of MurmurHash2
     *
     *  SOURCE: https://github.com/garycourt/murmurhash-js (MIT licensed)
     *
     * @author <a href="mailto:gary.court@gmail.com">Gary Court</a>
     * @see http://github.com/garycourt/murmurhash-js
     * @author <a href="mailto:aappleby@gmail.com">Austin Appleby</a>
     * @see http://sites.google.com/site/murmurhash/
     *
     * @param {string} str ASCII only
     * @param {number} seed Positive integer only
     * @return {number} 32-bit positive integer hash
     */

    function murmurhash2_32_gc(str, seed) {
        var
            l = str.length,
            h = seed ^ l,
            i = 0,
            k;

        while (l >= 4) {
            k =
                ((str.charCodeAt(i) & 0xff)) |
                ((str.charCodeAt(++i) & 0xff) << 8) |
                ((str.charCodeAt(++i) & 0xff) << 16) |
                ((str.charCodeAt(++i) & 0xff) << 24);

            k = (((k & 0xffff) * 0x5bd1e995) + ((((k >>> 16) * 0x5bd1e995) & 0xffff) << 16));
            k ^= k >>> 24;
            k = (((k & 0xffff) * 0x5bd1e995) + ((((k >>> 16) * 0x5bd1e995) & 0xffff) << 16));

            h = (((h & 0xffff) * 0x5bd1e995) + ((((h >>> 16) * 0x5bd1e995) & 0xffff) << 16)) ^ k;

            l -= 4;
            ++i;
        }

        switch (l) {
            case 3: h ^= (str.charCodeAt(i + 2) & 0xff) << 16;
            case 2: h ^= (str.charCodeAt(i + 1) & 0xff) << 8;
            case 1: h ^= (str.charCodeAt(i) & 0xff);
                h = (((h & 0xffff) * 0x5bd1e995) + ((((h >>> 16) * 0x5bd1e995) & 0xffff) << 16));
        }

        h ^= h >>> 13;
        h = (((h & 0xffff) * 0x5bd1e995) + ((((h >>> 16) * 0x5bd1e995) & 0xffff) << 16));
        h ^= h >>> 15;

        return h >>> 0;
    }

    ////////////////////////// PUBLIC INTERFACE /////////////////////////

    $.jStorage = {
        /* Version number */
        version: JSTORAGE_VERSION,

        /**
         * Sets a key's value.
         *
         * @param {String} key Key to set. If this value is not set or not
         *              a string an exception is raised.
         * @param {Mixed} value Value to set. This can be any value that is JSON
         *              compatible (Numbers, Strings, Objects etc.).
         * @param {Object} [options] - possible options to use
         * @param {Number} [options.TTL] - optional TTL value
         * @return {Mixed} the used value
         */
        set: function(key, value, options){
            _checkKey(key);

            options = options || {};

            // undefined values are deleted automatically
            if(typeof value == "undefined"){
                this.deleteKey(key);
                return value;
            }

            if(_XMLService.isXML(value)){
                value = {_is_xml:true,xml:_XMLService.encode(value)};
            }else if(typeof value == "function"){
                return undefined; // functions can't be saved!
            }else if(value && typeof value == "object"){
                // clone the object before saving to _storage tree
                value = JSON.parse(JSON.stringify(value));
            }

            _storage[key] = value;

            _storage.__jstorage_meta.CRC32[key] = "2." + murmurhash2_32_gc(JSON.stringify(value), 0x9747b28c);

            this.setTTL(key, options.TTL || 0); // also handles saving and _publishChange

            _fireObservers(key, "updated");
            return value;
        },

        /**
         * Looks up a key in cache
         *
         * @param {String} key - Key to look up.
         * @param {mixed} def - Default value to return, if key didn't exist.
         * @return {Mixed} the key value, default value or null
         */
        get: function(key, def){
            _checkKey(key);
            if(key in _storage){
                if(_storage[key] && typeof _storage[key] == "object" && _storage[key]._is_xml) {
                    return _XMLService.decode(_storage[key].xml);
                }else{
                    return _storage[key];
                }
            }
            return typeof(def) == "undefined" ? null : def;
        },

        /**
         * Deletes a key from cache.
         *
         * @param {String} key - Key to delete.
         * @return {Boolean} true if key existed or false if it didn't
         */
        deleteKey: function(key){
            _checkKey(key);
            if(key in _storage){
                delete _storage[key];
                // remove from TTL list
                if(typeof _storage.__jstorage_meta.TTL == "object" &&
                  key in _storage.__jstorage_meta.TTL){
                    delete _storage.__jstorage_meta.TTL[key];
                }

                delete _storage.__jstorage_meta.CRC32[key];

                _save();
                _publishChange();
                _fireObservers(key, "deleted");
                return true;
            }
            return false;
        },

        /**
         * Sets a TTL for a key, or remove it if ttl value is 0 or below
         *
         * @param {String} key - key to set the TTL for
         * @param {Number} ttl - TTL timeout in milliseconds
         * @return {Boolean} true if key existed or false if it didn't
         */
        setTTL: function(key, ttl){
            var curtime = +new Date();
            _checkKey(key);
            ttl = Number(ttl) || 0;
            if(key in _storage){

                if(!_storage.__jstorage_meta.TTL){
                    _storage.__jstorage_meta.TTL = {};
                }

                // Set TTL value for the key
                if(ttl>0){
                    _storage.__jstorage_meta.TTL[key] = curtime + ttl;
                }else{
                    delete _storage.__jstorage_meta.TTL[key];
                }

                _save();

                _handleTTL();

                _publishChange();
                return true;
            }
            return false;
        },

        /**
         * Gets remaining TTL (in milliseconds) for a key or 0 when no TTL has been set
         *
         * @param {String} key Key to check
         * @return {Number} Remaining TTL in milliseconds
         */
        getTTL: function(key){
            var curtime = +new Date(), ttl;
            _checkKey(key);
            if(key in _storage && _storage.__jstorage_meta.TTL && _storage.__jstorage_meta.TTL[key]){
                ttl = _storage.__jstorage_meta.TTL[key] - curtime;
                return ttl || 0;
            }
            return 0;
        },

        /**
         * Deletes everything in cache.
         *
         * @return {Boolean} Always true
         */
        flush: function(){
            _storage = {__jstorage_meta:{CRC32:{}}};
            _save();
            _publishChange();
            _fireObservers(null, "flushed");
            return true;
        },

        /**
         * Returns a read-only copy of _storage
         *
         * @return {Object} Read-only copy of _storage
        */
        storageObj: function(){
            function F() {}
            F.prototype = _storage;
            return new F();
        },

        /**
         * Returns an index of all used keys as an array
         * ["key1", "key2",.."keyN"]
         *
         * @return {Array} Used keys
        */
        index: function(){
            var index = [], i;
            for(i in _storage){
                if(_storage.hasOwnProperty(i) && i != "__jstorage_meta"){
                    index.push(i);
                }
            }
            return index;
        },

        /**
         * How much space in bytes does the storage take?
         *
         * @return {Number} Storage size in chars (not the same as in bytes,
         *                  since some chars may take several bytes)
         */
        storageSize: function(){
            return _storage_size;
        },

        /**
         * Which backend is currently in use?
         *
         * @return {String} Backend name
         */
        currentBackend: function(){
            return _backend;
        },

        /**
         * Test if storage is available
         *
         * @return {Boolean} True if storage can be used
         */
        storageAvailable: function(){
            return !!_backend;
        },

        /**
         * Register change listeners
         *
         * @param {String} key Key name
         * @param {Function} callback Function to run when the key changes
         */
        listenKeyChange: function(key, callback){
            _checkKey(key);
            if(!_observers[key]){
                _observers[key] = [];
            }
            _observers[key].push(callback);
        },

        /**
         * Remove change listeners
         *
         * @param {String} key Key name to unregister listeners against
         * @param {Function} [callback] If set, unregister the callback, if not - unregister all
         */
        stopListening: function(key, callback){
            _checkKey(key);

            if(!_observers[key]){
                return;
            }

            if(!callback){
                delete _observers[key];
                return;
            }

            for(var i = _observers[key].length - 1; i>=0; i--){
                if(_observers[key][i] == callback){
                    _observers[key].splice(i,1);
                }
            }
        },

        /**
         * Subscribe to a Publish/Subscribe event stream
         *
         * @param {String} channel Channel name
         * @param {Function} callback Function to run when the something is published to the channel
         */
        subscribe: function(channel, callback){
            channel = (channel || "").toString();
            if(!channel){
                throw new TypeError("Channel not defined");
            }
            if(!_pubsub_observers[channel]){
                _pubsub_observers[channel] = [];
            }
            _pubsub_observers[channel].push(callback);
        },

        /**
         * Publish data to an event stream
         *
         * @param {String} channel Channel name
         * @param {Mixed} payload Payload to deliver
         */
        publish: function(channel, payload){
            channel = (channel || "").toString();
            if(!channel){
                throw new TypeError("Channel not defined");
            }

            _publish(channel, payload);
        },

        /**
         * Reloads the data from browser storage
         */
        reInit: function(){
            _reloadData();
        },

        /**
         * Removes reference from global objects and saves it as jStorage
         *
         * @param {Boolean} option if needed to save object as simple "jStorage" in windows context
         */
         noConflict: function( saveInGlobal ) {
            delete window.$.jStorage

            if ( saveInGlobal ) {
                window.jStorage = this;
            }

            return this;
         }
    };

    // Initialize jStorage
    _init();

})();
;(function(){

/**
 * Require the given path.
 *
 * @param {String} path
 * @return {Object} exports
 * @api public
 */

function require(path, parent, orig) {
  var resolved = require.resolve(path);

  // lookup failed
  if (null == resolved) {
    orig = orig || path;
    parent = parent || 'root';
    var err = new Error('Failed to require "' + orig + '" from "' + parent + '"');
    err.path = orig;
    err.parent = parent;
    err.require = true;
    throw err;
  }

  var module = require.modules[resolved];

  // perform real require()
  // by invoking the module's
  // registered function
  if (!module.exports) {
    module.exports = {};
    module.client = module.component = true;
    module.call(this, module.exports, require.relative(resolved), module);
  }

  return module.exports;
}

/**
 * Registered modules.
 */

require.modules = {};

/**
 * Registered aliases.
 */

require.aliases = {};

/**
 * Resolve `path`.
 *
 * Lookup:
 *
 *   - PATH/index.js
 *   - PATH.js
 *   - PATH
 *
 * @param {String} path
 * @return {String} path or null
 * @api private
 */

require.resolve = function(path) {
  if (path.charAt(0) === '/') path = path.slice(1);

  var paths = [
    path,
    path + '.js',
    path + '.json',
    path + '/index.js',
    path + '/index.json'
  ];

  for (var i = 0; i < paths.length; i++) {
    var path = paths[i];
    if (require.modules.hasOwnProperty(path)) return path;
    if (require.aliases.hasOwnProperty(path)) return require.aliases[path];
  }
};

/**
 * Normalize `path` relative to the current path.
 *
 * @param {String} curr
 * @param {String} path
 * @return {String}
 * @api private
 */

require.normalize = function(curr, path) {
  var segs = [];

  if ('.' != path.charAt(0)) return path;

  curr = curr.split('/');
  path = path.split('/');

  for (var i = 0; i < path.length; ++i) {
    if ('..' == path[i]) {
      curr.pop();
    } else if ('.' != path[i] && '' != path[i]) {
      segs.push(path[i]);
    }
  }

  return curr.concat(segs).join('/');
};

/**
 * Register module at `path` with callback `definition`.
 *
 * @param {String} path
 * @param {Function} definition
 * @api private
 */

require.register = function(path, definition) {
  require.modules[path] = definition;
};

/**
 * Alias a module definition.
 *
 * @param {String} from
 * @param {String} to
 * @api private
 */

require.alias = function(from, to) {
  if (!require.modules.hasOwnProperty(from)) {
    throw new Error('Failed to alias "' + from + '", it does not exist');
  }
  require.aliases[to] = from;
};

/**
 * Return a require function relative to the `parent` path.
 *
 * @param {String} parent
 * @return {Function}
 * @api private
 */

require.relative = function(parent) {
  var p = require.normalize(parent, '..');

  /**
   * lastIndexOf helper.
   */

  function lastIndexOf(arr, obj) {
    var i = arr.length;
    while (i--) {
      if (arr[i] === obj) return i;
    }
    return -1;
  }

  /**
   * The relative require() itself.
   */

  function localRequire(path) {
    var resolved = localRequire.resolve(path);
    return require(resolved, parent, path);
  }

  /**
   * Resolve relative to the parent.
   */

  localRequire.resolve = function(path) {
    var c = path.charAt(0);
    if ('/' == c) return path.slice(1);
    if ('.' == c) return require.normalize(p, path);

    // resolve deps by returning
    // the dep in the nearest "deps"
    // directory
    var segs = parent.split('/');
    var i = lastIndexOf(segs, 'deps') + 1;
    if (!i) i = 0;
    path = segs.slice(0, i + 1).join('/') + '/deps/' + path;
    return path;
  };

  /**
   * Check if module is defined at `path`.
   */

  localRequire.exists = function(path) {
    return require.modules.hasOwnProperty(localRequire.resolve(path));
  };

  return localRequire;
};
require.register("component-indexof/index.js", function(exports, require, module){
module.exports = function(arr, obj){
  if (arr.indexOf) return arr.indexOf(obj);
  for (var i = 0; i < arr.length; ++i) {
    if (arr[i] === obj) return i;
  }
  return -1;
};
});
require.register("component-emitter/index.js", function(exports, require, module){

/**
 * Module dependencies.
 */

var index = require('indexof');

/**
 * Expose `Emitter`.
 */

module.exports = Emitter;

/**
 * Initialize a new `Emitter`.
 *
 * @api public
 */

function Emitter(obj) {
  if (obj) return mixin(obj);
};

/**
 * Mixin the emitter properties.
 *
 * @param {Object} obj
 * @return {Object}
 * @api private
 */

function mixin(obj) {
  for (var key in Emitter.prototype) {
    obj[key] = Emitter.prototype[key];
  }
  return obj;
}

/**
 * Listen on the given `event` with `fn`.
 *
 * @param {String} event
 * @param {Function} fn
 * @return {Emitter}
 * @api public
 */

Emitter.prototype.on =
Emitter.prototype.addEventListener = function(event, fn){
  this._callbacks = this._callbacks || {};
  (this._callbacks[event] = this._callbacks[event] || [])
    .push(fn);
  return this;
};

/**
 * Adds an `event` listener that will be invoked a single
 * time then automatically removed.
 *
 * @param {String} event
 * @param {Function} fn
 * @return {Emitter}
 * @api public
 */

Emitter.prototype.once = function(event, fn){
  var self = this;
  this._callbacks = this._callbacks || {};

  function on() {
    self.off(event, on);
    fn.apply(this, arguments);
  }

  fn._off = on;
  this.on(event, on);
  return this;
};

/**
 * Remove the given callback for `event` or all
 * registered callbacks.
 *
 * @param {String} event
 * @param {Function} fn
 * @return {Emitter}
 * @api public
 */

Emitter.prototype.off =
Emitter.prototype.removeListener =
Emitter.prototype.removeAllListeners =
Emitter.prototype.removeEventListener = function(event, fn){
  this._callbacks = this._callbacks || {};

  // all
  if (0 == arguments.length) {
    this._callbacks = {};
    return this;
  }

  // specific event
  var callbacks = this._callbacks[event];
  if (!callbacks) return this;

  // remove all handlers
  if (1 == arguments.length) {
    delete this._callbacks[event];
    return this;
  }

  // remove specific handler
  var i = index(callbacks, fn._off || fn);
  if (~i) callbacks.splice(i, 1);
  return this;
};

/**
 * Emit `event` with the given args.
 *
 * @param {String} event
 * @param {Mixed} ...
 * @return {Emitter}
 */

Emitter.prototype.emit = function(event){
  this._callbacks = this._callbacks || {};
  var args = [].slice.call(arguments, 1)
    , callbacks = this._callbacks[event];

  if (callbacks) {
    callbacks = callbacks.slice(0);
    for (var i = 0, len = callbacks.length; i < len; ++i) {
      callbacks[i].apply(this, args);
    }
  }

  return this;
};

/**
 * Return array of callbacks for `event`.
 *
 * @param {String} event
 * @return {Array}
 * @api public
 */

Emitter.prototype.listeners = function(event){
  this._callbacks = this._callbacks || {};
  return this._callbacks[event] || [];
};

/**
 * Check if this emitter has `event` handlers.
 *
 * @param {String} event
 * @return {Boolean}
 * @api public
 */

Emitter.prototype.hasListeners = function(event){
  return !! this.listeners(event).length;
};

});
require.register("RedVentures-reduce/index.js", function(exports, require, module){

/**
 * Reduce `arr` with `fn`.
 *
 * @param {Array} arr
 * @param {Function} fn
 * @param {Mixed} initial
 *
 * TODO: combatible error handling?
 */

module.exports = function(arr, fn, initial){  
  var idx = 0;
  var len = arr.length;
  var curr = arguments.length == 3
    ? initial
    : arr[idx++];

  while (idx < len) {
    curr = fn.call(null, curr, arr[idx], ++idx, arr);
  }
  
  return curr;
};
});
require.register("superagent/lib/client.js", function(exports, require, module){
/**
 * Module dependencies.
 */

var Emitter = require('emitter');
var reduce = require('reduce');

/**
 * Root reference for iframes.
 */

var root = 'undefined' == typeof window
  ? this
  : window;

/**
 * Noop.
 */

function noop(){};

/**
 * Check if `obj` is a host object,
 * we don't want to serialize these :)
 *
 * TODO: future proof, move to compoent land
 *
 * @param {Object} obj
 * @return {Boolean}
 * @api private
 */

function isHost(obj) {
  var str = {}.toString.call(obj);

  switch (str) {
    case '[object File]':
    case '[object Blob]':
    case '[object FormData]':
      return true;
    default:
      return false;
  }
}

/**
 * Determine XHR.
 */

function getXHR() {
  if (root.XMLHttpRequest
    && ('file:' != root.location.protocol || !root.ActiveXObject)) {
    return new XMLHttpRequest;
  } else {
    try { return new ActiveXObject('Microsoft.XMLHTTP'); } catch(e) {}
    try { return new ActiveXObject('Msxml2.XMLHTTP.6.0'); } catch(e) {}
    try { return new ActiveXObject('Msxml2.XMLHTTP.3.0'); } catch(e) {}
    try { return new ActiveXObject('Msxml2.XMLHTTP'); } catch(e) {}
  }
  return false;
}

/**
 * Removes leading and trailing whitespace, added to support IE.
 *
 * @param {String} s
 * @return {String}
 * @api private
 */

var trim = ''.trim
  ? function(s) { return s.trim(); }
  : function(s) { return s.replace(/(^\s*|\s*$)/g, ''); };

/**
 * Check if `obj` is an object.
 *
 * @param {Object} obj
 * @return {Boolean}
 * @api private
 */

function isObject(obj) {
  return obj === Object(obj);
}

/**
 * Serialize the given `obj`.
 *
 * @param {Object} obj
 * @return {String}
 * @api private
 */

function serialize(obj) {
  if (!isObject(obj)) return obj;
  var pairs = [];
  for (var key in obj) {
    pairs.push(encodeURIComponent(key)
      + '=' + encodeURIComponent(obj[key]));
  }
  return pairs.join('&');
}

/**
 * Expose serialization method.
 */

 request.serializeObject = serialize;

 /**
  * Parse the given x-www-form-urlencoded `str`.
  *
  * @param {String} str
  * @return {Object}
  * @api private
  */

function parseString(str) {
  var obj = {};
  var pairs = str.split('&');
  var parts;
  var pair;

  for (var i = 0, len = pairs.length; i < len; ++i) {
    pair = pairs[i];
    parts = pair.split('=');
    obj[decodeURIComponent(parts[0])] = decodeURIComponent(parts[1]);
  }

  return obj;
}

/**
 * Expose parser.
 */

request.parseString = parseString;

/**
 * Default MIME type map.
 *
 *     superagent.types.xml = 'application/xml';
 *
 */

request.types = {
  html: 'text/html',
  json: 'application/json',
  urlencoded: 'application/x-www-form-urlencoded',
  'form': 'application/x-www-form-urlencoded',
  'form-data': 'application/x-www-form-urlencoded'
};

/**
 * Default serialization map.
 *
 *     superagent.serialize['application/xml'] = function(obj){
 *       return 'generated xml here';
 *     };
 *
 */

 request.serialize = {
   'application/x-www-form-urlencoded': serialize,
   'application/json': JSON.stringify
 };

 /**
  * Default parsers.
  *
  *     superagent.parse['application/xml'] = function(str){
  *       return { object parsed from str };
  *     };
  *
  */

request.parse = {
  'application/x-www-form-urlencoded': parseString,
  'application/json': JSON.parse
};

/**
 * Parse the given header `str` into
 * an object containing the mapped fields.
 *
 * @param {String} str
 * @return {Object}
 * @api private
 */

function parseHeader(str) {
  var lines = str.split(/\r?\n/);
  var fields = {};
  var index;
  var line;
  var field;
  var val;

  lines.pop(); // trailing CRLF

  for (var i = 0, len = lines.length; i < len; ++i) {
    line = lines[i];
    index = line.indexOf(':');
    field = line.slice(0, index).toLowerCase();
    val = trim(line.slice(index + 1));
    fields[field] = val;
  }

  return fields;
}

/**
 * Return the mime type for the given `str`.
 *
 * @param {String} str
 * @return {String}
 * @api private
 */

function type(str){
  return str.split(/ *; */).shift();
};

/**
 * Return header field parameters.
 *
 * @param {String} str
 * @return {Object}
 * @api private
 */

function params(str){
  return reduce(str.split(/ *; */), function(obj, str){
    var parts = str.split(/ *= */)
      , key = parts.shift()
      , val = parts.shift();

    if (key && val) obj[key] = val;
    return obj;
  }, {});
};

/**
 * Initialize a new `Response` with the given `xhr`.
 *
 *  - set flags (.ok, .error, etc)
 *  - parse header
 *
 * Examples:
 *
 *  Aliasing `superagent` as `request` is nice:
 *
 *      request = superagent;
 *
 *  We can use the promise-like API, or pass callbacks:
 *
 *      request.get('/').end(function(res){});
 *      request.get('/', function(res){});
 *
 *  Sending data can be chained:
 *
 *      request
 *        .post('/user')
 *        .send({ name: 'tj' })
 *        .end(function(res){});
 *
 *  Or passed to `.send()`:
 *
 *      request
 *        .post('/user')
 *        .send({ name: 'tj' }, function(res){});
 *
 *  Or passed to `.post()`:
 *
 *      request
 *        .post('/user', { name: 'tj' })
 *        .end(function(res){});
 *
 * Or further reduced to a single call for simple cases:
 *
 *      request
 *        .post('/user', { name: 'tj' }, function(res){});
 *
 * @param {XMLHTTPRequest} xhr
 * @param {Object} options
 * @api private
 */

function Response(req, options) {
  options = options || {};
  this.req = req;
  this.xhr = this.req.xhr;
  this.text = this.xhr.responseText;
  this.setStatusProperties(this.xhr.status);
  this.header = this.headers = parseHeader(this.xhr.getAllResponseHeaders());
  // getAllResponseHeaders sometimes falsely returns "" for CORS requests, but
  // getResponseHeader still works. so we get content-type even if getting
  // other headers fails.
  this.header['content-type'] = this.xhr.getResponseHeader('content-type');
  this.setHeaderProperties(this.header);
  this.body = this.req.method != 'HEAD'
    ? this.parseBody(this.text)
    : null;
}

/**
 * Get case-insensitive `field` value.
 *
 * @param {String} field
 * @return {String}
 * @api public
 */

Response.prototype.get = function(field){
  return this.header[field.toLowerCase()];
};

/**
 * Set header related properties:
 *
 *   - `.type` the content type without params
 *
 * A response of "Content-Type: text/plain; charset=utf-8"
 * will provide you with a `.type` of "text/plain".
 *
 * @param {Object} header
 * @api private
 */

Response.prototype.setHeaderProperties = function(header){
  // content-type
  var ct = this.header['content-type'] || '';
  this.type = type(ct);

  // params
  var obj = params(ct);
  for (var key in obj) this[key] = obj[key];
};

/**
 * Parse the given body `str`.
 *
 * Used for auto-parsing of bodies. Parsers
 * are defined on the `superagent.parse` object.
 *
 * @param {String} str
 * @return {Mixed}
 * @api private
 */

Response.prototype.parseBody = function(str){
  var parse = request.parse[this.type];
  return parse
    ? parse(str)
    : null;
};

/**
 * Set flags such as `.ok` based on `status`.
 *
 * For example a 2xx response will give you a `.ok` of __true__
 * whereas 5xx will be __false__ and `.error` will be __true__. The
 * `.clientError` and `.serverError` are also available to be more
 * specific, and `.statusType` is the class of error ranging from 1..5
 * sometimes useful for mapping respond colors etc.
 *
 * "sugar" properties are also defined for common cases. Currently providing:
 *
 *   - .noContent
 *   - .badRequest
 *   - .unauthorized
 *   - .notAcceptable
 *   - .notFound
 *
 * @param {Number} status
 * @api private
 */

Response.prototype.setStatusProperties = function(status){
  var type = status / 100 | 0;

  // status / class
  this.status = status;
  this.statusType = type;

  // basics
  this.info = 1 == type;
  this.ok = 2 == type;
  this.clientError = 4 == type;
  this.serverError = 5 == type;
  this.error = (4 == type || 5 == type)
    ? this.toError()
    : false;

  // sugar
  this.accepted = 202 == status;
  this.noContent = 204 == status || 1223 == status;
  this.badRequest = 400 == status;
  this.unauthorized = 401 == status;
  this.notAcceptable = 406 == status;
  this.notFound = 404 == status;
  this.forbidden = 403 == status;
};

/**
 * Return an `Error` representative of this response.
 *
 * @return {Error}
 * @api public
 */

Response.prototype.toError = function(){
  var req = this.req;
  var method = req.method;
  var path = req.path;

  var msg = 'cannot ' + method + ' ' + path + ' (' + this.status + ')';
  var err = new Error(msg);
  err.status = this.status;
  err.method = method;
  err.path = path;

  return err;
};

/**
 * Expose `Response`.
 */

request.Response = Response;

/**
 * Initialize a new `Request` with the given `method` and `url`.
 *
 * @param {String} method
 * @param {String} url
 * @api public
 */

function Request(method, url) {
  var self = this;
  Emitter.call(this);
  this._query = this._query || [];
  this.method = method;
  this.url = url;
  this.header = {};
  this._header = {};
  this.on('end', function(){
    var res = new Response(self);
    if ('HEAD' == method) res.text = null;
    self.callback(null, res);
  });
}

/**
 * Mixin `Emitter`.
 */

Emitter(Request.prototype);

/**
 * Set timeout to `ms`.
 *
 * @param {Number} ms
 * @return {Request} for chaining
 * @api public
 */

Request.prototype.timeout = function(ms){
  this._timeout = ms;
  return this;
};

/**
 * Clear previous timeout.
 *
 * @return {Request} for chaining
 * @api public
 */

Request.prototype.clearTimeout = function(){
  this._timeout = 0;
  clearTimeout(this._timer);
  return this;
};

/**
 * Abort the request, and clear potential timeout.
 *
 * @return {Request}
 * @api public
 */

Request.prototype.abort = function(){
  if (this.aborted) return;
  this.aborted = true;
  this.xhr.abort();
  this.clearTimeout();
  this.emit('abort');
  return this;
};

/**
 * Set header `field` to `val`, or multiple fields with one object.
 *
 * Examples:
 *
 *      req.get('/')
 *        .set('Accept', 'application/json')
 *        .set('X-API-Key', 'foobar')
 *        .end(callback);
 *
 *      req.get('/')
 *        .set({ Accept: 'application/json', 'X-API-Key': 'foobar' })
 *        .end(callback);
 *
 * @param {String|Object} field
 * @param {String} val
 * @return {Request} for chaining
 * @api public
 */

Request.prototype.set = function(field, val){
  if (isObject(field)) {
    for (var key in field) {
      this.set(key, field[key]);
    }
    return this;
  }
  this._header[field.toLowerCase()] = val;
  this.header[field] = val;
  return this;
};

/**
 * Get case-insensitive header `field` value.
 *
 * @param {String} field
 * @return {String}
 * @api private
 */

Request.prototype.getHeader = function(field){
  return this._header[field.toLowerCase()];
};

/**
 * Set Content-Type to `type`, mapping values from `request.types`.
 *
 * Examples:
 *
 *      superagent.types.xml = 'application/xml';
 *
 *      request.post('/')
 *        .type('xml')
 *        .send(xmlstring)
 *        .end(callback);
 *
 *      request.post('/')
 *        .type('application/xml')
 *        .send(xmlstring)
 *        .end(callback);
 *
 * @param {String} type
 * @return {Request} for chaining
 * @api public
 */

Request.prototype.type = function(type){
  this.set('Content-Type', request.types[type] || type);
  return this;
};

/**
 * Set Authorization field value with `user` and `pass`.
 *
 * @param {String} user
 * @param {String} pass
 * @return {Request} for chaining
 * @api public
 */

Request.prototype.auth = function(user, pass){
  var str = btoa(user + ':' + pass);
  this.set('Authorization', 'Basic ' + str);
  return this;
};

/**
* Add query-string `val`.
*
* Examples:
*
*   request.get('/shoes')
*     .query('size=10')
*     .query({ color: 'blue' })
*
* @param {Object|String} val
* @return {Request} for chaining
* @api public
*/

Request.prototype.query = function(val){
  if ('string' != typeof val) val = serialize(val);
  if (val) this._query.push(val);
  return this;
};

/**
 * Send `data`, defaulting the `.type()` to "json" when
 * an object is given.
 *
 * Examples:
 *
 *       // querystring
 *       request.get('/search')
 *         .end(callback)
 *
 *       // multiple data "writes"
 *       request.get('/search')
 *         .send({ search: 'query' })
 *         .send({ range: '1..5' })
 *         .send({ order: 'desc' })
 *         .end(callback)
 *
 *       // manual json
 *       request.post('/user')
 *         .type('json')
 *         .send('{"name":"tj"})
 *         .end(callback)
 *
 *       // auto json
 *       request.post('/user')
 *         .send({ name: 'tj' })
 *         .end(callback)
 *
 *       // manual x-www-form-urlencoded
 *       request.post('/user')
 *         .type('form')
 *         .send('name=tj')
 *         .end(callback)
 *
 *       // auto x-www-form-urlencoded
 *       request.post('/user')
 *         .type('form')
 *         .send({ name: 'tj' })
 *         .end(callback)
 *
 *       // defaults to x-www-form-urlencoded
  *      request.post('/user')
  *        .send('name=tobi')
  *        .send('species=ferret')
  *        .end(callback)
 *
 * @param {String|Object} data
 * @return {Request} for chaining
 * @api public
 */

Request.prototype.send = function(data){
  var obj = isObject(data);
  var type = this.getHeader('Content-Type');

  // merge
  if (obj && isObject(this._data)) {
    for (var key in data) {
      this._data[key] = data[key];
    }
  } else if ('string' == typeof data) {
    if (!type) this.type('form');
    type = this.getHeader('Content-Type');
    if ('application/x-www-form-urlencoded' == type) {
      this._data = this._data
        ? this._data + '&' + data
        : data;
    } else {
      this._data = (this._data || '') + data;
    }
  } else {
    this._data = data;
  }

  if (!obj) return this;
  if (!type) this.type('json');
  return this;
};

/**
 * Invoke the callback with `err` and `res`
 * and handle arity check.
 *
 * @param {Error} err
 * @param {Response} res
 * @api private
 */

Request.prototype.callback = function(err, res){
  var fn = this._callback;
  if (2 == fn.length) return fn(err, res);
  if (err) return this.emit('error', err);
  fn(res);
};

/**
 * Invoke callback with x-domain error.
 *
 * @api private
 */

Request.prototype.crossDomainError = function(){
  var err = new Error('Origin is not allowed by Access-Control-Allow-Origin');
  err.crossDomain = true;
  this.callback(err);
};

/**
 * Invoke callback with timeout error.
 *
 * @api private
 */

Request.prototype.timeoutError = function(){
  var timeout = this._timeout;
  var err = new Error('timeout of ' + timeout + 'ms exceeded');
  err.timeout = timeout;
  this.callback(err);
};

/**
 * Enable transmission of cookies with x-domain requests.
 *
 * Note that for this to work the origin must not be
 * using "Access-Control-Allow-Origin" with a wildcard,
 * and also must set "Access-Control-Allow-Credentials"
 * to "true".
 *
 * @api public
 */

Request.prototype.withCredentials = function(){
  this._withCredentials = true;
  return this;
};

/**
 * Initiate request, invoking callback `fn(res)`
 * with an instanceof `Response`.
 *
 * @param {Function} fn
 * @return {Request} for chaining
 * @api public
 */

Request.prototype.end = function(fn){
  var self = this;
  var xhr = this.xhr = getXHR();
  var query = this._query.join('&');
  var timeout = this._timeout;
  var data = this._data;

  // store callback
  this._callback = fn || noop;

  // CORS
  if (this._withCredentials) xhr.withCredentials = true;

  // state change
  xhr.onreadystatechange = function(){
    if (4 != xhr.readyState) return;
    if (0 == xhr.status) {
      if (self.aborted) return self.timeoutError();
      return self.crossDomainError();
    }
    self.emit('end');
  };

  // progress
  if (xhr.upload) {
    xhr.upload.onprogress = function(e){
      e.percent = e.loaded / e.total * 100;
      self.emit('progress', e);
    };
  }

  // timeout
  if (timeout && !this._timer) {
    this._timer = setTimeout(function(){
      self.abort();
    }, timeout);
  }

  // querystring
  if (query) {
    query = request.serializeObject(query);
    this.url += ~this.url.indexOf('?')
      ? '&' + query
      : '?' + query;
  }

  // initiate request
  xhr.open(this.method, this.url, true);

  // body
  if ('GET' != this.method && 'HEAD' != this.method && 'string' != typeof data && !isHost(data)) {
    // serialize stuff
    var serialize = request.serialize[this.getHeader('Content-Type')];
    if (serialize) data = serialize(data);
  }

  // set header fields
  for (var field in this.header) {
    if (null == this.header[field]) continue;
    xhr.setRequestHeader(field, this.header[field]);
  }

  // send stuff
  xhr.send(data);
  return this;
};

/**
 * Expose `Request`.
 */

request.Request = Request;

/**
 * Issue a request:
 *
 * Examples:
 *
 *    request('GET', '/users').end(callback)
 *    request('/users').end(callback)
 *    request('/users', callback)
 *
 * @param {String} method
 * @param {String|Function} url or callback
 * @return {Request}
 * @api public
 */

function request(method, url) {
  // callback
  if ('function' == typeof url) {
    return new Request('GET', method).end(url);
  }

  // url first
  if (1 == arguments.length) {
    return new Request('GET', method);
  }

  return new Request(method, url);
}

/**
 * GET `url` with optional callback `fn(res)`.
 *
 * @param {String} url
 * @param {Mixed|Function} data or fn
 * @param {Function} fn
 * @return {Request}
 * @api public
 */

request.get = function(url, data, fn){
  var req = request('GET', url);
  if ('function' == typeof data) fn = data, data = null;
  if (data) req.query(data);
  if (fn) req.end(fn);
  return req;
};

/**
 * HEAD `url` with optional callback `fn(res)`.
 *
 * @param {String} url
 * @param {Mixed|Function} data or fn
 * @param {Function} fn
 * @return {Request}
 * @api public
 */

request.head = function(url, data, fn){
  var req = request('HEAD', url);
  if ('function' == typeof data) fn = data, data = null;
  if (data) req.send(data);
  if (fn) req.end(fn);
  return req;
};

/**
 * DELETE `url` with optional callback `fn(res)`.
 *
 * @param {String} url
 * @param {Function} fn
 * @return {Request}
 * @api public
 */

request.del = function(url, fn){
  var req = request('DELETE', url);
  if (fn) req.end(fn);
  return req;
};

/**
 * PATCH `url` with optional `data` and callback `fn(res)`.
 *
 * @param {String} url
 * @param {Mixed} data
 * @param {Function} fn
 * @return {Request}
 * @api public
 */

request.patch = function(url, data, fn){
  var req = request('PATCH', url);
  if ('function' == typeof data) fn = data, data = null;
  if (data) req.send(data);
  if (fn) req.end(fn);
  return req;
};

/**
 * POST `url` with optional `data` and callback `fn(res)`.
 *
 * @param {String} url
 * @param {Mixed} data
 * @param {Function} fn
 * @return {Request}
 * @api public
 */

request.post = function(url, data, fn){
  var req = request('POST', url);
  if ('function' == typeof data) fn = data, data = null;
  if (data) req.send(data);
  if (fn) req.end(fn);
  return req;
};

/**
 * PUT `url` with optional `data` and callback `fn(res)`.
 *
 * @param {String} url
 * @param {Mixed|Function} data or fn
 * @param {Function} fn
 * @return {Request}
 * @api public
 */

request.put = function(url, data, fn){
  var req = request('PUT', url);
  if ('function' == typeof data) fn = data, data = null;
  if (data) req.send(data);
  if (fn) req.end(fn);
  return req;
};

/**
 * Expose `request`.
 */

module.exports = request;

});


require.alias("component-emitter/index.js", "superagent/deps/emitter/index.js");
require.alias("component-emitter/index.js", "emitter/index.js");
require.alias("component-indexof/index.js", "component-emitter/deps/indexof/index.js");

require.alias("RedVentures-reduce/index.js", "superagent/deps/reduce/index.js");
require.alias("RedVentures-reduce/index.js", "reduce/index.js");

require.alias("superagent/lib/client.js", "superagent/index.js");if (typeof exports == "object") {
  module.exports = require("superagent");
} else if (typeof define == "function" && define.amd) {
  define(function(){ return require("superagent"); });
} else {
  this["superagent"] = require("superagent");
}})();
//! moment.js
//! version : 2.4.0
//! authors : Tim Wood, Iskren Chernev, Moment.js contributors
//! license : MIT
//! momentjs.com
(function(a){function b(a,b){return function(c){return i(a.call(this,c),b)}}function c(a,b){return function(c){return this.lang().ordinal(a.call(this,c),b)}}function d(){}function e(a){u(a),g(this,a)}function f(a){var b=o(a),c=b.year||0,d=b.month||0,e=b.week||0,f=b.day||0,g=b.hour||0,h=b.minute||0,i=b.second||0,j=b.millisecond||0;this._input=a,this._milliseconds=+j+1e3*i+6e4*h+36e5*g,this._days=+f+7*e,this._months=+d+12*c,this._data={},this._bubble()}function g(a,b){for(var c in b)b.hasOwnProperty(c)&&(a[c]=b[c]);return b.hasOwnProperty("toString")&&(a.toString=b.toString),b.hasOwnProperty("valueOf")&&(a.valueOf=b.valueOf),a}function h(a){return 0>a?Math.ceil(a):Math.floor(a)}function i(a,b){for(var c=a+"";c.length<b;)c="0"+c;return c}function j(a,b,c,d){var e,f,g=b._milliseconds,h=b._days,i=b._months;g&&a._d.setTime(+a._d+g*c),(h||i)&&(e=a.minute(),f=a.hour()),h&&a.date(a.date()+h*c),i&&a.month(a.month()+i*c),g&&!d&&bb.updateOffset(a),(h||i)&&(a.minute(e),a.hour(f))}function k(a){return"[object Array]"===Object.prototype.toString.call(a)}function l(a){return"[object Date]"===Object.prototype.toString.call(a)||a instanceof Date}function m(a,b,c){var d,e=Math.min(a.length,b.length),f=Math.abs(a.length-b.length),g=0;for(d=0;e>d;d++)(c&&a[d]!==b[d]||!c&&q(a[d])!==q(b[d]))&&g++;return g+f}function n(a){if(a){var b=a.toLowerCase().replace(/(.)s$/,"$1");a=Kb[a]||Lb[b]||b}return a}function o(a){var b,c,d={};for(c in a)a.hasOwnProperty(c)&&(b=n(c),b&&(d[b]=a[c]));return d}function p(b){var c,d;if(0===b.indexOf("week"))c=7,d="day";else{if(0!==b.indexOf("month"))return;c=12,d="month"}bb[b]=function(e,f){var g,h,i=bb.fn._lang[b],j=[];if("number"==typeof e&&(f=e,e=a),h=function(a){var b=bb().utc().set(d,a);return i.call(bb.fn._lang,b,e||"")},null!=f)return h(f);for(g=0;c>g;g++)j.push(h(g));return j}}function q(a){var b=+a,c=0;return 0!==b&&isFinite(b)&&(c=b>=0?Math.floor(b):Math.ceil(b)),c}function r(a,b){return new Date(Date.UTC(a,b+1,0)).getUTCDate()}function s(a){return t(a)?366:365}function t(a){return 0===a%4&&0!==a%100||0===a%400}function u(a){var b;a._a&&-2===a._pf.overflow&&(b=a._a[gb]<0||a._a[gb]>11?gb:a._a[hb]<1||a._a[hb]>r(a._a[fb],a._a[gb])?hb:a._a[ib]<0||a._a[ib]>23?ib:a._a[jb]<0||a._a[jb]>59?jb:a._a[kb]<0||a._a[kb]>59?kb:a._a[lb]<0||a._a[lb]>999?lb:-1,a._pf._overflowDayOfYear&&(fb>b||b>hb)&&(b=hb),a._pf.overflow=b)}function v(a){a._pf={empty:!1,unusedTokens:[],unusedInput:[],overflow:-2,charsLeftOver:0,nullInput:!1,invalidMonth:null,invalidFormat:!1,userInvalidated:!1,iso:!1}}function w(a){return null==a._isValid&&(a._isValid=!isNaN(a._d.getTime())&&a._pf.overflow<0&&!a._pf.empty&&!a._pf.invalidMonth&&!a._pf.nullInput&&!a._pf.invalidFormat&&!a._pf.userInvalidated,a._strict&&(a._isValid=a._isValid&&0===a._pf.charsLeftOver&&0===a._pf.unusedTokens.length)),a._isValid}function x(a){return a?a.toLowerCase().replace("_","-"):a}function y(a,b){return b.abbr=a,mb[a]||(mb[a]=new d),mb[a].set(b),mb[a]}function z(a){delete mb[a]}function A(a){var b,c,d,e,f=0,g=function(a){if(!mb[a]&&nb)try{require("./lang/"+a)}catch(b){}return mb[a]};if(!a)return bb.fn._lang;if(!k(a)){if(c=g(a))return c;a=[a]}for(;f<a.length;){for(e=x(a[f]).split("-"),b=e.length,d=x(a[f+1]),d=d?d.split("-"):null;b>0;){if(c=g(e.slice(0,b).join("-")))return c;if(d&&d.length>=b&&m(e,d,!0)>=b-1)break;b--}f++}return bb.fn._lang}function B(a){return a.match(/\[[\s\S]/)?a.replace(/^\[|\]$/g,""):a.replace(/\\/g,"")}function C(a){var b,c,d=a.match(rb);for(b=0,c=d.length;c>b;b++)d[b]=Pb[d[b]]?Pb[d[b]]:B(d[b]);return function(e){var f="";for(b=0;c>b;b++)f+=d[b]instanceof Function?d[b].call(e,a):d[b];return f}}function D(a,b){return a.isValid()?(b=E(b,a.lang()),Mb[b]||(Mb[b]=C(b)),Mb[b](a)):a.lang().invalidDate()}function E(a,b){function c(a){return b.longDateFormat(a)||a}var d=5;for(sb.lastIndex=0;d>=0&&sb.test(a);)a=a.replace(sb,c),sb.lastIndex=0,d-=1;return a}function F(a,b){var c;switch(a){case"DDDD":return vb;case"YYYY":case"GGGG":case"gggg":return wb;case"YYYYY":case"GGGGG":case"ggggg":return xb;case"S":case"SS":case"SSS":case"DDD":return ub;case"MMM":case"MMMM":case"dd":case"ddd":case"dddd":return zb;case"a":case"A":return A(b._l)._meridiemParse;case"X":return Cb;case"Z":case"ZZ":return Ab;case"T":return Bb;case"SSSS":return yb;case"MM":case"DD":case"YY":case"GG":case"gg":case"HH":case"hh":case"mm":case"ss":case"M":case"D":case"d":case"H":case"h":case"m":case"s":case"w":case"ww":case"W":case"WW":case"e":case"E":return tb;default:return c=new RegExp(N(M(a.replace("\\","")),"i"))}}function G(a){var b=(Ab.exec(a)||[])[0],c=(b+"").match(Hb)||["-",0,0],d=+(60*c[1])+q(c[2]);return"+"===c[0]?-d:d}function H(a,b,c){var d,e=c._a;switch(a){case"M":case"MM":null!=b&&(e[gb]=q(b)-1);break;case"MMM":case"MMMM":d=A(c._l).monthsParse(b),null!=d?e[gb]=d:c._pf.invalidMonth=b;break;case"D":case"DD":null!=b&&(e[hb]=q(b));break;case"DDD":case"DDDD":null!=b&&(c._dayOfYear=q(b));break;case"YY":e[fb]=q(b)+(q(b)>68?1900:2e3);break;case"YYYY":case"YYYYY":e[fb]=q(b);break;case"a":case"A":c._isPm=A(c._l).isPM(b);break;case"H":case"HH":case"h":case"hh":e[ib]=q(b);break;case"m":case"mm":e[jb]=q(b);break;case"s":case"ss":e[kb]=q(b);break;case"S":case"SS":case"SSS":case"SSSS":e[lb]=q(1e3*("0."+b));break;case"X":c._d=new Date(1e3*parseFloat(b));break;case"Z":case"ZZ":c._useUTC=!0,c._tzm=G(b);break;case"w":case"ww":case"W":case"WW":case"d":case"dd":case"ddd":case"dddd":case"e":case"E":a=a.substr(0,1);case"gg":case"gggg":case"GG":case"GGGG":case"GGGGG":a=a.substr(0,2),b&&(c._w=c._w||{},c._w[a]=b)}}function I(a){var b,c,d,e,f,g,h,i,j,k,l=[];if(!a._d){for(d=K(a),a._w&&null==a._a[hb]&&null==a._a[gb]&&(f=function(b){return b?b.length<3?parseInt(b,10)>68?"19"+b:"20"+b:b:null==a._a[fb]?bb().weekYear():a._a[fb]},g=a._w,null!=g.GG||null!=g.W||null!=g.E?h=X(f(g.GG),g.W||1,g.E,4,1):(i=A(a._l),j=null!=g.d?T(g.d,i):null!=g.e?parseInt(g.e,10)+i._week.dow:0,k=parseInt(g.w,10)||1,null!=g.d&&j<i._week.dow&&k++,h=X(f(g.gg),k,j,i._week.doy,i._week.dow)),a._a[fb]=h.year,a._dayOfYear=h.dayOfYear),a._dayOfYear&&(e=null==a._a[fb]?d[fb]:a._a[fb],a._dayOfYear>s(e)&&(a._pf._overflowDayOfYear=!0),c=S(e,0,a._dayOfYear),a._a[gb]=c.getUTCMonth(),a._a[hb]=c.getUTCDate()),b=0;3>b&&null==a._a[b];++b)a._a[b]=l[b]=d[b];for(;7>b;b++)a._a[b]=l[b]=null==a._a[b]?2===b?1:0:a._a[b];l[ib]+=q((a._tzm||0)/60),l[jb]+=q((a._tzm||0)%60),a._d=(a._useUTC?S:R).apply(null,l)}}function J(a){var b;a._d||(b=o(a._i),a._a=[b.year,b.month,b.day,b.hour,b.minute,b.second,b.millisecond],I(a))}function K(a){var b=new Date;return a._useUTC?[b.getUTCFullYear(),b.getUTCMonth(),b.getUTCDate()]:[b.getFullYear(),b.getMonth(),b.getDate()]}function L(a){a._a=[],a._pf.empty=!0;var b,c,d,e,f,g=A(a._l),h=""+a._i,i=h.length,j=0;for(d=E(a._f,g).match(rb)||[],b=0;b<d.length;b++)e=d[b],c=(F(e,a).exec(h)||[])[0],c&&(f=h.substr(0,h.indexOf(c)),f.length>0&&a._pf.unusedInput.push(f),h=h.slice(h.indexOf(c)+c.length),j+=c.length),Pb[e]?(c?a._pf.empty=!1:a._pf.unusedTokens.push(e),H(e,c,a)):a._strict&&!c&&a._pf.unusedTokens.push(e);a._pf.charsLeftOver=i-j,h.length>0&&a._pf.unusedInput.push(h),a._isPm&&a._a[ib]<12&&(a._a[ib]+=12),a._isPm===!1&&12===a._a[ib]&&(a._a[ib]=0),I(a),u(a)}function M(a){return a.replace(/\\(\[)|\\(\])|\[([^\]\[]*)\]|\\(.)/g,function(a,b,c,d,e){return b||c||d||e})}function N(a){return a.replace(/[-\/\\^$*+?.()|[\]{}]/g,"\\$&")}function O(a){var b,c,d,e,f;if(0===a._f.length)return a._pf.invalidFormat=!0,a._d=new Date(0/0),void 0;for(e=0;e<a._f.length;e++)f=0,b=g({},a),v(b),b._f=a._f[e],L(b),w(b)&&(f+=b._pf.charsLeftOver,f+=10*b._pf.unusedTokens.length,b._pf.score=f,(null==d||d>f)&&(d=f,c=b));g(a,c||b)}function P(a){var b,c=a._i,d=Db.exec(c);if(d){for(a._pf.iso=!0,b=4;b>0;b--)if(d[b]){a._f=Fb[b-1]+(d[6]||" ");break}for(b=0;4>b;b++)if(Gb[b][1].exec(c)){a._f+=Gb[b][0];break}Ab.exec(c)&&(a._f+="Z"),L(a)}else a._d=new Date(c)}function Q(b){var c=b._i,d=ob.exec(c);c===a?b._d=new Date:d?b._d=new Date(+d[1]):"string"==typeof c?P(b):k(c)?(b._a=c.slice(0),I(b)):l(c)?b._d=new Date(+c):"object"==typeof c?J(b):b._d=new Date(c)}function R(a,b,c,d,e,f,g){var h=new Date(a,b,c,d,e,f,g);return 1970>a&&h.setFullYear(a),h}function S(a){var b=new Date(Date.UTC.apply(null,arguments));return 1970>a&&b.setUTCFullYear(a),b}function T(a,b){if("string"==typeof a)if(isNaN(a)){if(a=b.weekdaysParse(a),"number"!=typeof a)return null}else a=parseInt(a,10);return a}function U(a,b,c,d,e){return e.relativeTime(b||1,!!c,a,d)}function V(a,b,c){var d=eb(Math.abs(a)/1e3),e=eb(d/60),f=eb(e/60),g=eb(f/24),h=eb(g/365),i=45>d&&["s",d]||1===e&&["m"]||45>e&&["mm",e]||1===f&&["h"]||22>f&&["hh",f]||1===g&&["d"]||25>=g&&["dd",g]||45>=g&&["M"]||345>g&&["MM",eb(g/30)]||1===h&&["y"]||["yy",h];return i[2]=b,i[3]=a>0,i[4]=c,U.apply({},i)}function W(a,b,c){var d,e=c-b,f=c-a.day();return f>e&&(f-=7),e-7>f&&(f+=7),d=bb(a).add("d",f),{week:Math.ceil(d.dayOfYear()/7),year:d.year()}}function X(a,b,c,d,e){var f,g,h=new Date(Date.UTC(a,0)).getUTCDay();return c=null!=c?c:e,f=e-h+(h>d?7:0),g=7*(b-1)+(c-e)+f+1,{year:g>0?a:a-1,dayOfYear:g>0?g:s(a-1)+g}}function Y(a){var b=a._i,c=a._f;return"undefined"==typeof a._pf&&v(a),null===b?bb.invalid({nullInput:!0}):("string"==typeof b&&(a._i=b=A().preparse(b)),bb.isMoment(b)?(a=g({},b),a._d=new Date(+b._d)):c?k(c)?O(a):L(a):Q(a),new e(a))}function Z(a,b){bb.fn[a]=bb.fn[a+"s"]=function(a){var c=this._isUTC?"UTC":"";return null!=a?(this._d["set"+c+b](a),bb.updateOffset(this),this):this._d["get"+c+b]()}}function $(a){bb.duration.fn[a]=function(){return this._data[a]}}function _(a,b){bb.duration.fn["as"+a]=function(){return+this/b}}function ab(a){var b=!1,c=bb;"undefined"==typeof ender&&(this.moment=a?function(){return!b&&console&&console.warn&&(b=!0,console.warn("Accessing Moment through the global scope is deprecated, and will be removed in an upcoming release.")),c.apply(null,arguments)}:bb)}for(var bb,cb,db="2.4.0",eb=Math.round,fb=0,gb=1,hb=2,ib=3,jb=4,kb=5,lb=6,mb={},nb="undefined"!=typeof module&&module.exports,ob=/^\/?Date\((\-?\d+)/i,pb=/(\-)?(?:(\d*)\.)?(\d+)\:(\d+)(?:\:(\d+)\.?(\d{3})?)?/,qb=/^(-)?P(?:(?:([0-9,.]*)Y)?(?:([0-9,.]*)M)?(?:([0-9,.]*)D)?(?:T(?:([0-9,.]*)H)?(?:([0-9,.]*)M)?(?:([0-9,.]*)S)?)?|([0-9,.]*)W)$/,rb=/(\[[^\[]*\])|(\\)?(Mo|MM?M?M?|Do|DDDo|DD?D?D?|ddd?d?|do?|w[o|w]?|W[o|W]?|YYYYY|YYYY|YY|gg(ggg?)?|GG(GGG?)?|e|E|a|A|hh?|HH?|mm?|ss?|S{1,4}|X|zz?|ZZ?|.)/g,sb=/(\[[^\[]*\])|(\\)?(LT|LL?L?L?|l{1,4})/g,tb=/\d\d?/,ub=/\d{1,3}/,vb=/\d{3}/,wb=/\d{1,4}/,xb=/[+\-]?\d{1,6}/,yb=/\d+/,zb=/[0-9]*['a-z\u00A0-\u05FF\u0700-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF]+|[\u0600-\u06FF\/]+(\s*?[\u0600-\u06FF]+){1,2}/i,Ab=/Z|[\+\-]\d\d:?\d\d/i,Bb=/T/i,Cb=/[\+\-]?\d+(\.\d{1,3})?/,Db=/^\s*\d{4}-(?:(\d\d-\d\d)|(W\d\d$)|(W\d\d-\d)|(\d\d\d))((T| )(\d\d(:\d\d(:\d\d(\.\d+)?)?)?)?([\+\-]\d\d:?\d\d|Z)?)?$/,Eb="YYYY-MM-DDTHH:mm:ssZ",Fb=["YYYY-MM-DD","GGGG-[W]WW","GGGG-[W]WW-E","YYYY-DDD"],Gb=[["HH:mm:ss.SSSS",/(T| )\d\d:\d\d:\d\d\.\d{1,3}/],["HH:mm:ss",/(T| )\d\d:\d\d:\d\d/],["HH:mm",/(T| )\d\d:\d\d/],["HH",/(T| )\d\d/]],Hb=/([\+\-]|\d\d)/gi,Ib="Date|Hours|Minutes|Seconds|Milliseconds".split("|"),Jb={Milliseconds:1,Seconds:1e3,Minutes:6e4,Hours:36e5,Days:864e5,Months:2592e6,Years:31536e6},Kb={ms:"millisecond",s:"second",m:"minute",h:"hour",d:"day",D:"date",w:"week",W:"isoWeek",M:"month",y:"year",DDD:"dayOfYear",e:"weekday",E:"isoWeekday",gg:"weekYear",GG:"isoWeekYear"},Lb={dayofyear:"dayOfYear",isoweekday:"isoWeekday",isoweek:"isoWeek",weekyear:"weekYear",isoweekyear:"isoWeekYear"},Mb={},Nb="DDD w W M D d".split(" "),Ob="M D H h m s w W".split(" "),Pb={M:function(){return this.month()+1},MMM:function(a){return this.lang().monthsShort(this,a)},MMMM:function(a){return this.lang().months(this,a)},D:function(){return this.date()},DDD:function(){return this.dayOfYear()},d:function(){return this.day()},dd:function(a){return this.lang().weekdaysMin(this,a)},ddd:function(a){return this.lang().weekdaysShort(this,a)},dddd:function(a){return this.lang().weekdays(this,a)},w:function(){return this.week()},W:function(){return this.isoWeek()},YY:function(){return i(this.year()%100,2)},YYYY:function(){return i(this.year(),4)},YYYYY:function(){return i(this.year(),5)},gg:function(){return i(this.weekYear()%100,2)},gggg:function(){return this.weekYear()},ggggg:function(){return i(this.weekYear(),5)},GG:function(){return i(this.isoWeekYear()%100,2)},GGGG:function(){return this.isoWeekYear()},GGGGG:function(){return i(this.isoWeekYear(),5)},e:function(){return this.weekday()},E:function(){return this.isoWeekday()},a:function(){return this.lang().meridiem(this.hours(),this.minutes(),!0)},A:function(){return this.lang().meridiem(this.hours(),this.minutes(),!1)},H:function(){return this.hours()},h:function(){return this.hours()%12||12},m:function(){return this.minutes()},s:function(){return this.seconds()},S:function(){return q(this.milliseconds()/100)},SS:function(){return i(q(this.milliseconds()/10),2)},SSS:function(){return i(this.milliseconds(),3)},SSSS:function(){return i(this.milliseconds(),3)},Z:function(){var a=-this.zone(),b="+";return 0>a&&(a=-a,b="-"),b+i(q(a/60),2)+":"+i(q(a)%60,2)},ZZ:function(){var a=-this.zone(),b="+";return 0>a&&(a=-a,b="-"),b+i(q(10*a/6),4)},z:function(){return this.zoneAbbr()},zz:function(){return this.zoneName()},X:function(){return this.unix()}},Qb=["months","monthsShort","weekdays","weekdaysShort","weekdaysMin"];Nb.length;)cb=Nb.pop(),Pb[cb+"o"]=c(Pb[cb],cb);for(;Ob.length;)cb=Ob.pop(),Pb[cb+cb]=b(Pb[cb],2);for(Pb.DDDD=b(Pb.DDD,3),g(d.prototype,{set:function(a){var b,c;for(c in a)b=a[c],"function"==typeof b?this[c]=b:this["_"+c]=b},_months:"January_February_March_April_May_June_July_August_September_October_November_December".split("_"),months:function(a){return this._months[a.month()]},_monthsShort:"Jan_Feb_Mar_Apr_May_Jun_Jul_Aug_Sep_Oct_Nov_Dec".split("_"),monthsShort:function(a){return this._monthsShort[a.month()]},monthsParse:function(a){var b,c,d;for(this._monthsParse||(this._monthsParse=[]),b=0;12>b;b++)if(this._monthsParse[b]||(c=bb.utc([2e3,b]),d="^"+this.months(c,"")+"|^"+this.monthsShort(c,""),this._monthsParse[b]=new RegExp(d.replace(".",""),"i")),this._monthsParse[b].test(a))return b},_weekdays:"Sunday_Monday_Tuesday_Wednesday_Thursday_Friday_Saturday".split("_"),weekdays:function(a){return this._weekdays[a.day()]},_weekdaysShort:"Sun_Mon_Tue_Wed_Thu_Fri_Sat".split("_"),weekdaysShort:function(a){return this._weekdaysShort[a.day()]},_weekdaysMin:"Su_Mo_Tu_We_Th_Fr_Sa".split("_"),weekdaysMin:function(a){return this._weekdaysMin[a.day()]},weekdaysParse:function(a){var b,c,d;for(this._weekdaysParse||(this._weekdaysParse=[]),b=0;7>b;b++)if(this._weekdaysParse[b]||(c=bb([2e3,1]).day(b),d="^"+this.weekdays(c,"")+"|^"+this.weekdaysShort(c,"")+"|^"+this.weekdaysMin(c,""),this._weekdaysParse[b]=new RegExp(d.replace(".",""),"i")),this._weekdaysParse[b].test(a))return b},_longDateFormat:{LT:"h:mm A",L:"MM/DD/YYYY",LL:"MMMM D YYYY",LLL:"MMMM D YYYY LT",LLLL:"dddd, MMMM D YYYY LT"},longDateFormat:function(a){var b=this._longDateFormat[a];return!b&&this._longDateFormat[a.toUpperCase()]&&(b=this._longDateFormat[a.toUpperCase()].replace(/MMMM|MM|DD|dddd/g,function(a){return a.slice(1)}),this._longDateFormat[a]=b),b},isPM:function(a){return"p"===(a+"").toLowerCase().charAt(0)},_meridiemParse:/[ap]\.?m?\.?/i,meridiem:function(a,b,c){return a>11?c?"pm":"PM":c?"am":"AM"},_calendar:{sameDay:"[Today at] LT",nextDay:"[Tomorrow at] LT",nextWeek:"dddd [at] LT",lastDay:"[Yesterday at] LT",lastWeek:"[Last] dddd [at] LT",sameElse:"L"},calendar:function(a,b){var c=this._calendar[a];return"function"==typeof c?c.apply(b):c},_relativeTime:{future:"in %s",past:"%s ago",s:"a few seconds",m:"a minute",mm:"%d minutes",h:"an hour",hh:"%d hours",d:"a day",dd:"%d days",M:"a month",MM:"%d months",y:"a year",yy:"%d years"},relativeTime:function(a,b,c,d){var e=this._relativeTime[c];return"function"==typeof e?e(a,b,c,d):e.replace(/%d/i,a)},pastFuture:function(a,b){var c=this._relativeTime[a>0?"future":"past"];return"function"==typeof c?c(b):c.replace(/%s/i,b)},ordinal:function(a){return this._ordinal.replace("%d",a)},_ordinal:"%d",preparse:function(a){return a},postformat:function(a){return a},week:function(a){return W(a,this._week.dow,this._week.doy).week},_week:{dow:0,doy:6},_invalidDate:"Invalid date",invalidDate:function(){return this._invalidDate}}),bb=function(b,c,d,e){return"boolean"==typeof d&&(e=d,d=a),Y({_i:b,_f:c,_l:d,_strict:e,_isUTC:!1})},bb.utc=function(b,c,d,e){var f;return"boolean"==typeof d&&(e=d,d=a),f=Y({_useUTC:!0,_isUTC:!0,_l:d,_i:b,_f:c,_strict:e}).utc()},bb.unix=function(a){return bb(1e3*a)},bb.duration=function(a,b){var c,d,e,g=bb.isDuration(a),h="number"==typeof a,i=g?a._input:h?{}:a,j=null;return h?b?i[b]=a:i.milliseconds=a:(j=pb.exec(a))?(c="-"===j[1]?-1:1,i={y:0,d:q(j[hb])*c,h:q(j[ib])*c,m:q(j[jb])*c,s:q(j[kb])*c,ms:q(j[lb])*c}):(j=qb.exec(a))&&(c="-"===j[1]?-1:1,e=function(a){var b=a&&parseFloat(a.replace(",","."));return(isNaN(b)?0:b)*c},i={y:e(j[2]),M:e(j[3]),d:e(j[4]),h:e(j[5]),m:e(j[6]),s:e(j[7]),w:e(j[8])}),d=new f(i),g&&a.hasOwnProperty("_lang")&&(d._lang=a._lang),d},bb.version=db,bb.defaultFormat=Eb,bb.updateOffset=function(){},bb.lang=function(a,b){var c;return a?(b?y(x(a),b):null===b?(z(a),a="en"):mb[a]||A(a),c=bb.duration.fn._lang=bb.fn._lang=A(a),c._abbr):bb.fn._lang._abbr},bb.langData=function(a){return a&&a._lang&&a._lang._abbr&&(a=a._lang._abbr),A(a)},bb.isMoment=function(a){return a instanceof e},bb.isDuration=function(a){return a instanceof f},cb=Qb.length-1;cb>=0;--cb)p(Qb[cb]);for(bb.normalizeUnits=function(a){return n(a)},bb.invalid=function(a){var b=bb.utc(0/0);return null!=a?g(b._pf,a):b._pf.userInvalidated=!0,b},bb.parseZone=function(a){return bb(a).parseZone()},g(bb.fn=e.prototype,{clone:function(){return bb(this)},valueOf:function(){return+this._d+6e4*(this._offset||0)},unix:function(){return Math.floor(+this/1e3)},toString:function(){return this.clone().lang("en").format("ddd MMM DD YYYY HH:mm:ss [GMT]ZZ")},toDate:function(){return this._offset?new Date(+this):this._d},toISOString:function(){return D(bb(this).utc(),"YYYY-MM-DD[T]HH:mm:ss.SSS[Z]")},toArray:function(){var a=this;return[a.year(),a.month(),a.date(),a.hours(),a.minutes(),a.seconds(),a.milliseconds()]},isValid:function(){return w(this)},isDSTShifted:function(){return this._a?this.isValid()&&m(this._a,(this._isUTC?bb.utc(this._a):bb(this._a)).toArray())>0:!1},parsingFlags:function(){return g({},this._pf)},invalidAt:function(){return this._pf.overflow},utc:function(){return this.zone(0)},local:function(){return this.zone(0),this._isUTC=!1,this},format:function(a){var b=D(this,a||bb.defaultFormat);return this.lang().postformat(b)},add:function(a,b){var c;return c="string"==typeof a?bb.duration(+b,a):bb.duration(a,b),j(this,c,1),this},subtract:function(a,b){var c;return c="string"==typeof a?bb.duration(+b,a):bb.duration(a,b),j(this,c,-1),this},diff:function(a,b,c){var d,e,f=this._isUTC?bb(a).zone(this._offset||0):bb(a).local(),g=6e4*(this.zone()-f.zone());return b=n(b),"year"===b||"month"===b?(d=432e5*(this.daysInMonth()+f.daysInMonth()),e=12*(this.year()-f.year())+(this.month()-f.month()),e+=(this-bb(this).startOf("month")-(f-bb(f).startOf("month")))/d,e-=6e4*(this.zone()-bb(this).startOf("month").zone()-(f.zone()-bb(f).startOf("month").zone()))/d,"year"===b&&(e/=12)):(d=this-f,e="second"===b?d/1e3:"minute"===b?d/6e4:"hour"===b?d/36e5:"day"===b?(d-g)/864e5:"week"===b?(d-g)/6048e5:d),c?e:h(e)},from:function(a,b){return bb.duration(this.diff(a)).lang(this.lang()._abbr).humanize(!b)},fromNow:function(a){return this.from(bb(),a)},calendar:function(){var a=this.diff(bb().zone(this.zone()).startOf("day"),"days",!0),b=-6>a?"sameElse":-1>a?"lastWeek":0>a?"lastDay":1>a?"sameDay":2>a?"nextDay":7>a?"nextWeek":"sameElse";return this.format(this.lang().calendar(b,this))},isLeapYear:function(){return t(this.year())},isDST:function(){return this.zone()<this.clone().month(0).zone()||this.zone()<this.clone().month(5).zone()},day:function(a){var b=this._isUTC?this._d.getUTCDay():this._d.getDay();return null!=a?(a=T(a,this.lang()),this.add({d:a-b})):b},month:function(a){var b,c=this._isUTC?"UTC":"";return null!=a?"string"==typeof a&&(a=this.lang().monthsParse(a),"number"!=typeof a)?this:(b=this.date(),this.date(1),this._d["set"+c+"Month"](a),this.date(Math.min(b,this.daysInMonth())),bb.updateOffset(this),this):this._d["get"+c+"Month"]()},startOf:function(a){switch(a=n(a)){case"year":this.month(0);case"month":this.date(1);case"week":case"isoWeek":case"day":this.hours(0);case"hour":this.minutes(0);case"minute":this.seconds(0);case"second":this.milliseconds(0)}return"week"===a?this.weekday(0):"isoWeek"===a&&this.isoWeekday(1),this},endOf:function(a){return a=n(a),this.startOf(a).add("isoWeek"===a?"week":a,1).subtract("ms",1)},isAfter:function(a,b){return b="undefined"!=typeof b?b:"millisecond",+this.clone().startOf(b)>+bb(a).startOf(b)},isBefore:function(a,b){return b="undefined"!=typeof b?b:"millisecond",+this.clone().startOf(b)<+bb(a).startOf(b)},isSame:function(a,b){return b="undefined"!=typeof b?b:"millisecond",+this.clone().startOf(b)===+bb(a).startOf(b)},min:function(a){return a=bb.apply(null,arguments),this>a?this:a},max:function(a){return a=bb.apply(null,arguments),a>this?this:a},zone:function(a){var b=this._offset||0;return null==a?this._isUTC?b:this._d.getTimezoneOffset():("string"==typeof a&&(a=G(a)),Math.abs(a)<16&&(a=60*a),this._offset=a,this._isUTC=!0,b!==a&&j(this,bb.duration(b-a,"m"),1,!0),this)},zoneAbbr:function(){return this._isUTC?"UTC":""},zoneName:function(){return this._isUTC?"Coordinated Universal Time":""},parseZone:function(){return"string"==typeof this._i&&this.zone(this._i),this},hasAlignedHourOffset:function(a){return a=a?bb(a).zone():0,0===(this.zone()-a)%60},daysInMonth:function(){return r(this.year(),this.month())},dayOfYear:function(a){var b=eb((bb(this).startOf("day")-bb(this).startOf("year"))/864e5)+1;return null==a?b:this.add("d",a-b)},weekYear:function(a){var b=W(this,this.lang()._week.dow,this.lang()._week.doy).year;return null==a?b:this.add("y",a-b)},isoWeekYear:function(a){var b=W(this,1,4).year;return null==a?b:this.add("y",a-b)},week:function(a){var b=this.lang().week(this);return null==a?b:this.add("d",7*(a-b))},isoWeek:function(a){var b=W(this,1,4).week;return null==a?b:this.add("d",7*(a-b))},weekday:function(a){var b=(this.day()+7-this.lang()._week.dow)%7;return null==a?b:this.add("d",a-b)},isoWeekday:function(a){return null==a?this.day()||7:this.day(this.day()%7?a:a-7)},get:function(a){return a=n(a),this[a]()},set:function(a,b){return a=n(a),"function"==typeof this[a]&&this[a](b),this},lang:function(b){return b===a?this._lang:(this._lang=A(b),this)}}),cb=0;cb<Ib.length;cb++)Z(Ib[cb].toLowerCase().replace(/s$/,""),Ib[cb]);Z("year","FullYear"),bb.fn.days=bb.fn.day,bb.fn.months=bb.fn.month,bb.fn.weeks=bb.fn.week,bb.fn.isoWeeks=bb.fn.isoWeek,bb.fn.toJSON=bb.fn.toISOString,g(bb.duration.fn=f.prototype,{_bubble:function(){var a,b,c,d,e=this._milliseconds,f=this._days,g=this._months,i=this._data;i.milliseconds=e%1e3,a=h(e/1e3),i.seconds=a%60,b=h(a/60),i.minutes=b%60,c=h(b/60),i.hours=c%24,f+=h(c/24),i.days=f%30,g+=h(f/30),i.months=g%12,d=h(g/12),i.years=d},weeks:function(){return h(this.days()/7)},valueOf:function(){return this._milliseconds+864e5*this._days+2592e6*(this._months%12)+31536e6*q(this._months/12)},humanize:function(a){var b=+this,c=V(b,!a,this.lang());return a&&(c=this.lang().pastFuture(b,c)),this.lang().postformat(c)},add:function(a,b){var c=bb.duration(a,b);return this._milliseconds+=c._milliseconds,this._days+=c._days,this._months+=c._months,this._bubble(),this},subtract:function(a,b){var c=bb.duration(a,b);return this._milliseconds-=c._milliseconds,this._days-=c._days,this._months-=c._months,this._bubble(),this},get:function(a){return a=n(a),this[a.toLowerCase()+"s"]()},as:function(a){return a=n(a),this["as"+a.charAt(0).toUpperCase()+a.slice(1)+"s"]()},lang:bb.fn.lang,toIsoString:function(){var a=Math.abs(this.years()),b=Math.abs(this.months()),c=Math.abs(this.days()),d=Math.abs(this.hours()),e=Math.abs(this.minutes()),f=Math.abs(this.seconds()+this.milliseconds()/1e3);return this.asSeconds()?(this.asSeconds()<0?"-":"")+"P"+(a?a+"Y":"")+(b?b+"M":"")+(c?c+"D":"")+(d||e||f?"T":"")+(d?d+"H":"")+(e?e+"M":"")+(f?f+"S":""):"P0D"}});for(cb in Jb)Jb.hasOwnProperty(cb)&&(_(cb,Jb[cb]),$(cb.toLowerCase()));_("Weeks",6048e5),bb.duration.fn.asMonths=function(){return(+this-31536e6*this.years())/2592e6+12*this.years()},bb.lang("en",{ordinal:function(a){var b=a%10,c=1===q(a%100/10)?"th":1===b?"st":2===b?"nd":3===b?"rd":"th";return a+c}}),function(a){a(bb)}(function(a){return a.lang("ar-ma",{months:"ÙŠÙ†Ø§ÙŠØ±_ÙØ¨Ø±Ø§ÙŠØ±_Ù…Ø§Ø±Ø³_Ø£Ø¨Ø±ÙŠÙ„_Ù…Ø§ÙŠ_ÙŠÙˆÙ†ÙŠÙˆ_ÙŠÙˆÙ„ÙŠÙˆØ²_ØºØ´Øª_Ø´ØªÙ†Ø¨Ø±_Ø£ÙƒØªÙˆØ¨Ø±_Ù†ÙˆÙ†Ø¨Ø±_Ø¯Ø¬Ù†Ø¨Ø±".split("_"),monthsShort:"ÙŠÙ†Ø§ÙŠØ±_ÙØ¨Ø±Ø§ÙŠØ±_Ù…Ø§Ø±Ø³_Ø£Ø¨Ø±ÙŠÙ„_Ù…Ø§ÙŠ_ÙŠÙˆÙ†ÙŠÙˆ_ÙŠÙˆÙ„ÙŠÙˆØ²_ØºØ´Øª_Ø´ØªÙ†Ø¨Ø±_Ø£ÙƒØªÙˆØ¨Ø±_Ù†ÙˆÙ†Ø¨Ø±_Ø¯Ø¬Ù†Ø¨Ø±".split("_"),weekdays:"Ø§Ù„Ø£Ø­Ø¯_Ø§Ù„Ø¥ØªÙ†ÙŠÙ†_Ø§Ù„Ø«Ù„Ø§Ø«Ø§Ø¡_Ø§Ù„Ø£Ø±Ø¨Ø¹Ø§Ø¡_Ø§Ù„Ø®Ù…ÙŠØ³_Ø§Ù„Ø¬Ù…Ø¹Ø©_Ø§Ù„Ø³Ø¨Øª".split("_"),weekdaysShort:"Ø§Ø­Ø¯_Ø§ØªÙ†ÙŠÙ†_Ø«Ù„Ø§Ø«Ø§Ø¡_Ø§Ø±Ø¨Ø¹Ø§Ø¡_Ø®Ù…ÙŠØ³_Ø¬Ù…Ø¹Ø©_Ø³Ø¨Øª".split("_"),weekdaysMin:"Ø­_Ù†_Ø«_Ø±_Ø®_Ø¬_Ø³".split("_"),longDateFormat:{LT:"HH:mm",L:"DD/MM/YYYY",LL:"D MMMM YYYY",LLL:"D MMMM YYYY LT",LLLL:"dddd D MMMM YYYY LT"},calendar:{sameDay:"[Ø§Ù„ÙŠÙˆÙ… Ø¹Ù„Ù‰ Ø§Ù„Ø³Ø§Ø¹Ø©] LT",nextDay:"[ØºØ¯Ø§ Ø¹Ù„Ù‰ Ø§Ù„Ø³Ø§Ø¹Ø©] LT",nextWeek:"dddd [Ø¹Ù„Ù‰ Ø§Ù„Ø³Ø§Ø¹Ø©] LT",lastDay:"[Ø£Ù…Ø³ Ø¹Ù„Ù‰ Ø§Ù„Ø³Ø§Ø¹Ø©] LT",lastWeek:"dddd [Ø¹Ù„Ù‰ Ø§Ù„Ø³Ø§Ø¹Ø©] LT",sameElse:"L"},relativeTime:{future:"ÙÙŠ %s",past:"Ù…Ù†Ø° %s",s:"Ø«ÙˆØ§Ù†",m:"Ø¯Ù‚ÙŠÙ‚Ø©",mm:"%d Ø¯Ù‚Ø§Ø¦Ù‚",h:"Ø³Ø§Ø¹Ø©",hh:"%d Ø³Ø§Ø¹Ø§Øª",d:"ÙŠÙˆÙ…",dd:"%d Ø£ÙŠØ§Ù…",M:"Ø´Ù‡Ø±",MM:"%d Ø£Ø´Ù‡Ø±",y:"Ø³Ù†Ø©",yy:"%d Ø³Ù†ÙˆØ§Øª"},week:{dow:6,doy:12}})}),function(a){a(bb)}(function(a){return a.lang("ar",{months:"ÙŠÙ†Ø§ÙŠØ±/ ÙƒØ§Ù†ÙˆÙ† Ø§Ù„Ø«Ø§Ù†ÙŠ_ÙØ¨Ø±Ø§ÙŠØ±/ Ø´Ø¨Ø§Ø·_Ù…Ø§Ø±Ø³/ Ø¢Ø°Ø§Ø±_Ø£Ø¨Ø±ÙŠÙ„/ Ù†ÙŠØ³Ø§Ù†_Ù…Ø§ÙŠÙˆ/ Ø£ÙŠØ§Ø±_ÙŠÙˆÙ†ÙŠÙˆ/ Ø­Ø²ÙŠØ±Ø§Ù†_ÙŠÙˆÙ„ÙŠÙˆ/ ØªÙ…ÙˆØ²_Ø£ØºØ³Ø·Ø³/ Ø¢Ø¨_Ø³Ø¨ØªÙ…Ø¨Ø±/ Ø£ÙŠÙ„ÙˆÙ„_Ø£ÙƒØªÙˆØ¨Ø±/ ØªØ´Ø±ÙŠÙ† Ø§Ù„Ø£ÙˆÙ„_Ù†ÙˆÙÙ…Ø¨Ø±/ ØªØ´Ø±ÙŠÙ† Ø§Ù„Ø«Ø§Ù†ÙŠ_Ø¯ÙŠØ³Ù…Ø¨Ø±/ ÙƒØ§Ù†ÙˆÙ† Ø§Ù„Ø£ÙˆÙ„".split("_"),monthsShort:"ÙŠÙ†Ø§ÙŠØ±/ ÙƒØ§Ù†ÙˆÙ† Ø§Ù„Ø«Ø§Ù†ÙŠ_ÙØ¨Ø±Ø§ÙŠØ±/ Ø´Ø¨Ø§Ø·_Ù…Ø§Ø±Ø³/ Ø¢Ø°Ø§Ø±_Ø£Ø¨Ø±ÙŠÙ„/ Ù†ÙŠØ³Ø§Ù†_Ù…Ø§ÙŠÙˆ/ Ø£ÙŠØ§Ø±_ÙŠÙˆÙ†ÙŠÙˆ/ Ø­Ø²ÙŠØ±Ø§Ù†_ÙŠÙˆÙ„ÙŠÙˆ/ ØªÙ…ÙˆØ²_Ø£ØºØ³Ø·Ø³/ Ø¢Ø¨_Ø³Ø¨ØªÙ…Ø¨Ø±/ Ø£ÙŠÙ„ÙˆÙ„_Ø£ÙƒØªÙˆØ¨Ø±/ ØªØ´Ø±ÙŠÙ† Ø§Ù„Ø£ÙˆÙ„_Ù†ÙˆÙÙ…Ø¨Ø±/ ØªØ´Ø±ÙŠÙ† Ø§Ù„Ø«Ø§Ù†ÙŠ_Ø¯ÙŠØ³Ù…Ø¨Ø±/ ÙƒØ§Ù†ÙˆÙ† Ø§Ù„Ø£ÙˆÙ„".split("_"),weekdays:"Ø§Ù„Ø£Ø­Ø¯_Ø§Ù„Ø¥Ø«Ù†ÙŠÙ†_Ø§Ù„Ø«Ù„Ø§Ø«Ø§Ø¡_Ø§Ù„Ø£Ø±Ø¨Ø¹Ø§Ø¡_Ø§Ù„Ø®Ù…ÙŠØ³_Ø§Ù„Ø¬Ù…Ø¹Ø©_Ø§Ù„Ø³Ø¨Øª".split("_"),weekdaysShort:"Ø§Ù„Ø£Ø­Ø¯_Ø§Ù„Ø¥Ø«Ù†ÙŠÙ†_Ø§Ù„Ø«Ù„Ø§Ø«Ø§Ø¡_Ø§Ù„Ø£Ø±Ø¨Ø¹Ø§Ø¡_Ø§Ù„Ø®Ù…ÙŠØ³_Ø§Ù„Ø¬Ù…Ø¹Ø©_Ø§Ù„Ø³Ø¨Øª".split("_"),weekdaysMin:"Ø­_Ù†_Ø«_Ø±_Ø®_Ø¬_Ø³".split("_"),longDateFormat:{LT:"HH:mm",L:"DD/MM/YYYY",LL:"D MMMM YYYY",LLL:"D MMMM YYYY LT",LLLL:"dddd D MMMM YYYY LT"},calendar:{sameDay:"[Ø§Ù„ÙŠÙˆÙ… Ø¹Ù„Ù‰ Ø§Ù„Ø³Ø§Ø¹Ø©] LT",nextDay:"[ØºØ¯Ø§ Ø¹Ù„Ù‰ Ø§Ù„Ø³Ø§Ø¹Ø©] LT",nextWeek:"dddd [Ø¹Ù„Ù‰ Ø§Ù„Ø³Ø§Ø¹Ø©] LT",lastDay:"[Ø£Ù…Ø³ Ø¹Ù„Ù‰ Ø§Ù„Ø³Ø§Ø¹Ø©] LT",lastWeek:"dddd [Ø¹Ù„Ù‰ Ø§Ù„Ø³Ø§Ø¹Ø©] LT",sameElse:"L"},relativeTime:{future:"ÙÙŠ %s",past:"Ù…Ù†Ø° %s",s:"Ø«ÙˆØ§Ù†",m:"Ø¯Ù‚ÙŠÙ‚Ø©",mm:"%d Ø¯Ù‚Ø§Ø¦Ù‚",h:"Ø³Ø§Ø¹Ø©",hh:"%d Ø³Ø§Ø¹Ø§Øª",d:"ÙŠÙˆÙ…",dd:"%d Ø£ÙŠØ§Ù…",M:"Ø´Ù‡Ø±",MM:"%d Ø£Ø´Ù‡Ø±",y:"Ø³Ù†Ø©",yy:"%d Ø³Ù†ÙˆØ§Øª"},week:{dow:6,doy:12}})}),function(a){a(bb)}(function(a){return a.lang("bg",{months:"ÑÐ½ÑƒÐ°Ñ€Ð¸_Ñ„ÐµÐ²Ñ€ÑƒÐ°Ñ€Ð¸_Ð¼Ð°Ñ€Ñ‚_Ð°Ð¿Ñ€Ð¸Ð»_Ð¼Ð°Ð¹_ÑŽÐ½Ð¸_ÑŽÐ»Ð¸_Ð°Ð²Ð³ÑƒÑÑ‚_ÑÐµÐ¿Ñ‚ÐµÐ¼Ð²Ñ€Ð¸_Ð¾ÐºÑ‚Ð¾Ð¼Ð²Ñ€Ð¸_Ð½Ð¾ÐµÐ¼Ð²Ñ€Ð¸_Ð´ÐµÐºÐµÐ¼Ð²Ñ€Ð¸".split("_"),monthsShort:"ÑÐ½Ñ€_Ñ„ÐµÐ²_Ð¼Ð°Ñ€_Ð°Ð¿Ñ€_Ð¼Ð°Ð¹_ÑŽÐ½Ð¸_ÑŽÐ»Ð¸_Ð°Ð²Ð³_ÑÐµÐ¿_Ð¾ÐºÑ‚_Ð½Ð¾Ðµ_Ð´ÐµÐº".split("_"),weekdays:"Ð½ÐµÐ´ÐµÐ»Ñ_Ð¿Ð¾Ð½ÐµÐ´ÐµÐ»Ð½Ð¸Ðº_Ð²Ñ‚Ð¾Ñ€Ð½Ð¸Ðº_ÑÑ€ÑÐ´Ð°_Ñ‡ÐµÑ‚Ð²ÑŠÑ€Ñ‚ÑŠÐº_Ð¿ÐµÑ‚ÑŠÐº_ÑÑŠÐ±Ð¾Ñ‚Ð°".split("_"),weekdaysShort:"Ð½ÐµÐ´_Ð¿Ð¾Ð½_Ð²Ñ‚Ð¾_ÑÑ€Ñ_Ñ‡ÐµÑ‚_Ð¿ÐµÑ‚_ÑÑŠÐ±".split("_"),weekdaysMin:"Ð½Ð´_Ð¿Ð½_Ð²Ñ‚_ÑÑ€_Ñ‡Ñ‚_Ð¿Ñ‚_ÑÐ±".split("_"),longDateFormat:{LT:"H:mm",L:"D.MM.YYYY",LL:"D MMMM YYYY",LLL:"D MMMM YYYY LT",LLLL:"dddd, D MMMM YYYY LT"},calendar:{sameDay:"[Ð”Ð½ÐµÑ Ð²] LT",nextDay:"[Ð£Ñ‚Ñ€Ðµ Ð²] LT",nextWeek:"dddd [Ð²] LT",lastDay:"[Ð’Ñ‡ÐµÑ€Ð° Ð²] LT",lastWeek:function(){switch(this.day()){case 0:case 3:case 6:return"[Ð’ Ð¸Ð·Ð¼Ð¸Ð½Ð°Ð»Ð°Ñ‚Ð°] dddd [Ð²] LT";case 1:case 2:case 4:case 5:return"[Ð’ Ð¸Ð·Ð¼Ð¸Ð½Ð°Ð»Ð¸Ñ] dddd [Ð²] LT"}},sameElse:"L"},relativeTime:{future:"ÑÐ»ÐµÐ´ %s",past:"Ð¿Ñ€ÐµÐ´Ð¸ %s",s:"Ð½ÑÐºÐ¾Ð»ÐºÐ¾ ÑÐµÐºÑƒÐ½Ð´Ð¸",m:"Ð¼Ð¸Ð½ÑƒÑ‚Ð°",mm:"%d Ð¼Ð¸Ð½ÑƒÑ‚Ð¸",h:"Ñ‡Ð°Ñ",hh:"%d Ñ‡Ð°ÑÐ°",d:"Ð´ÐµÐ½",dd:"%d Ð´Ð½Ð¸",M:"Ð¼ÐµÑÐµÑ†",MM:"%d Ð¼ÐµÑÐµÑ†Ð°",y:"Ð³Ð¾Ð´Ð¸Ð½Ð°",yy:"%d Ð³Ð¾Ð´Ð¸Ð½Ð¸"},ordinal:function(a){var b=a%10,c=a%100;return 0===a?a+"-ÐµÐ²":0===c?a+"-ÐµÐ½":c>10&&20>c?a+"-Ñ‚Ð¸":1===b?a+"-Ð²Ð¸":2===b?a+"-Ñ€Ð¸":7===b||8===b?a+"-Ð¼Ð¸":a+"-Ñ‚Ð¸"},week:{dow:1,doy:7}})}),function(a){a(bb)}(function(b){function c(a,b,c){var d={mm:"munutenn",MM:"miz",dd:"devezh"};return a+" "+f(d[c],a)}function d(a){switch(e(a)){case 1:case 3:case 4:case 5:case 9:return a+" bloaz";default:return a+" vloaz"}}function e(a){return a>9?e(a%10):a}function f(a,b){return 2===b?g(a):a}function g(b){var c={m:"v",b:"v",d:"z"};return c[b.charAt(0)]===a?b:c[b.charAt(0)]+b.substring(1)}return b.lang("br",{months:"Genver_C'hwevrer_Meurzh_Ebrel_Mae_Mezheven_Gouere_Eost_Gwengolo_Here_Du_Kerzu".split("_"),monthsShort:"Gen_C'hwe_Meu_Ebr_Mae_Eve_Gou_Eos_Gwe_Her_Du_Ker".split("_"),weekdays:"Sul_Lun_Meurzh_Merc'her_Yaou_Gwener_Sadorn".split("_"),weekdaysShort:"Sul_Lun_Meu_Mer_Yao_Gwe_Sad".split("_"),weekdaysMin:"Su_Lu_Me_Mer_Ya_Gw_Sa".split("_"),longDateFormat:{LT:"h[e]mm A",L:"DD/MM/YYYY",LL:"D [a viz] MMMM YYYY",LLL:"D [a viz] MMMM YYYY LT",LLLL:"dddd, D [a viz] MMMM YYYY LT"},calendar:{sameDay:"[Hiziv da] LT",nextDay:"[Warc'hoazh da] LT",nextWeek:"dddd [da] LT",lastDay:"[Dec'h da] LT",lastWeek:"dddd [paset da] LT",sameElse:"L"},relativeTime:{future:"a-benn %s",past:"%s 'zo",s:"un nebeud segondennoÃ¹",m:"ur vunutenn",mm:c,h:"un eur",hh:"%d eur",d:"un devezh",dd:c,M:"ur miz",MM:c,y:"ur bloaz",yy:d},ordinal:function(a){var b=1===a?"aÃ±":"vet";return a+b},week:{dow:1,doy:4}})}),function(a){a(bb)}(function(a){function b(a,b,c){var d=a+" ";switch(c){case"m":return b?"jedna minuta":"jedne minute";case"mm":return d+=1===a?"minuta":2===a||3===a||4===a?"minute":"minuta";case"h":return b?"jedan sat":"jednog sata";case"hh":return d+=1===a?"sat":2===a||3===a||4===a?"sata":"sati";case"dd":return d+=1===a?"dan":"dana";case"MM":return d+=1===a?"mjesec":2===a||3===a||4===a?"mjeseca":"mjeseci";case"yy":return d+=1===a?"godina":2===a||3===a||4===a?"godine":"godina"}}return a.lang("bs",{months:"januar_februar_mart_april_maj_juni_juli_avgust_septembar_oktobar_novembar_decembar".split("_"),monthsShort:"jan._feb._mar._apr._maj._jun._jul._avg._sep._okt._nov._dec.".split("_"),weekdays:"nedjelja_ponedjeljak_utorak_srijeda_Äetvrtak_petak_subota".split("_"),weekdaysShort:"ned._pon._uto._sri._Äet._pet._sub.".split("_"),weekdaysMin:"ne_po_ut_sr_Äe_pe_su".split("_"),longDateFormat:{LT:"H:mm",L:"DD. MM. YYYY",LL:"D. MMMM YYYY",LLL:"D. MMMM YYYY LT",LLLL:"dddd, D. MMMM YYYY LT"},calendar:{sameDay:"[danas u] LT",nextDay:"[sutra u] LT",nextWeek:function(){switch(this.day()){case 0:return"[u] [nedjelju] [u] LT";case 3:return"[u] [srijedu] [u] LT";case 6:return"[u] [subotu] [u] LT";case 1:case 2:case 4:case 5:return"[u] dddd [u] LT"}},lastDay:"[juÄer u] LT",lastWeek:function(){switch(this.day()){case 0:case 3:return"[proÅ¡lu] dddd [u] LT";case 6:return"[proÅ¡le] [subote] [u] LT";case 1:case 2:case 4:case 5:return"[proÅ¡li] dddd [u] LT"}},sameElse:"L"},relativeTime:{future:"za %s",past:"prije %s",s:"par sekundi",m:b,mm:b,h:b,hh:b,d:"dan",dd:b,M:"mjesec",MM:b,y:"godinu",yy:b},ordinal:"%d.",week:{dow:1,doy:7}})}),function(a){a(bb)}(function(a){return a.lang("ca",{months:"Gener_Febrer_MarÃ§_Abril_Maig_Juny_Juliol_Agost_Setembre_Octubre_Novembre_Desembre".split("_"),monthsShort:"Gen._Febr._Mar._Abr._Mai._Jun._Jul._Ag._Set._Oct._Nov._Des.".split("_"),weekdays:"Diumenge_Dilluns_Dimarts_Dimecres_Dijous_Divendres_Dissabte".split("_"),weekdaysShort:"Dg._Dl._Dt._Dc._Dj._Dv._Ds.".split("_"),weekdaysMin:"Dg_Dl_Dt_Dc_Dj_Dv_Ds".split("_"),longDateFormat:{LT:"H:mm",L:"DD/MM/YYYY",LL:"D MMMM YYYY",LLL:"D MMMM YYYY LT",LLLL:"dddd D MMMM YYYY LT"},calendar:{sameDay:function(){return"[avui a "+(1!==this.hours()?"les":"la")+"] LT"},nextDay:function(){return"[demÃ  a "+(1!==this.hours()?"les":"la")+"] LT"},nextWeek:function(){return"dddd [a "+(1!==this.hours()?"les":"la")+"] LT"},lastDay:function(){return"[ahir a "+(1!==this.hours()?"les":"la")+"] LT"},lastWeek:function(){return"[el] dddd [passat a "+(1!==this.hours()?"les":"la")+"] LT"},sameElse:"L"},relativeTime:{future:"en %s",past:"fa %s",s:"uns segons",m:"un minut",mm:"%d minuts",h:"una hora",hh:"%d hores",d:"un dia",dd:"%d dies",M:"un mes",MM:"%d mesos",y:"un any",yy:"%d anys"},ordinal:"%d",week:{dow:1,doy:4}})}),function(a){a(bb)}(function(a){function b(a){return a>1&&5>a&&1!==~~(a/10)}function c(a,c,d,e){var f=a+" ";switch(d){case"s":return c||e?"pÃ¡r vteÅ™in":"pÃ¡r vteÅ™inami";case"m":return c?"minuta":e?"minutu":"minutou";case"mm":return c||e?f+(b(a)?"minuty":"minut"):f+"minutami";
break;case"h":return c?"hodina":e?"hodinu":"hodinou";case"hh":return c||e?f+(b(a)?"hodiny":"hodin"):f+"hodinami";break;case"d":return c||e?"den":"dnem";case"dd":return c||e?f+(b(a)?"dny":"dnÃ­"):f+"dny";break;case"M":return c||e?"mÄ›sÃ­c":"mÄ›sÃ­cem";case"MM":return c||e?f+(b(a)?"mÄ›sÃ­ce":"mÄ›sÃ­cÅ¯"):f+"mÄ›sÃ­ci";break;case"y":return c||e?"rok":"rokem";case"yy":return c||e?f+(b(a)?"roky":"let"):f+"lety"}}var d="leden_Ãºnor_bÅ™ezen_duben_kvÄ›ten_Äerven_Äervenec_srpen_zÃ¡Å™Ã­_Å™Ã­jen_listopad_prosinec".split("_"),e="led_Ãºno_bÅ™e_dub_kvÄ›_Ävn_Ävc_srp_zÃ¡Å™_Å™Ã­j_lis_pro".split("_");return a.lang("cs",{months:d,monthsShort:e,monthsParse:function(a,b){var c,d=[];for(c=0;12>c;c++)d[c]=new RegExp("^"+a[c]+"$|^"+b[c]+"$","i");return d}(d,e),weekdays:"nedÄ›le_pondÄ›lÃ­_ÃºterÃ½_stÅ™eda_Ätvrtek_pÃ¡tek_sobota".split("_"),weekdaysShort:"ne_po_Ãºt_st_Ät_pÃ¡_so".split("_"),weekdaysMin:"ne_po_Ãºt_st_Ät_pÃ¡_so".split("_"),longDateFormat:{LT:"H:mm",L:"DD.MM.YYYY",LL:"D. MMMM YYYY",LLL:"D. MMMM YYYY LT",LLLL:"dddd D. MMMM YYYY LT"},calendar:{sameDay:"[dnes v] LT",nextDay:"[zÃ­tra v] LT",nextWeek:function(){switch(this.day()){case 0:return"[v nedÄ›li v] LT";case 1:case 2:return"[v] dddd [v] LT";case 3:return"[ve stÅ™edu v] LT";case 4:return"[ve Ätvrtek v] LT";case 5:return"[v pÃ¡tek v] LT";case 6:return"[v sobotu v] LT"}},lastDay:"[vÄera v] LT",lastWeek:function(){switch(this.day()){case 0:return"[minulou nedÄ›li v] LT";case 1:case 2:return"[minulÃ©] dddd [v] LT";case 3:return"[minulou stÅ™edu v] LT";case 4:case 5:return"[minulÃ½] dddd [v] LT";case 6:return"[minulou sobotu v] LT"}},sameElse:"L"},relativeTime:{future:"za %s",past:"pÅ™ed %s",s:c,m:c,mm:c,h:c,hh:c,d:c,dd:c,M:c,MM:c,y:c,yy:c},ordinal:"%d.",week:{dow:1,doy:4}})}),function(a){a(bb)}(function(a){return a.lang("cv",{months:"ÐºÄƒÑ€Ð»Ð°Ñ‡_Ð½Ð°Ñ€ÄƒÑ_Ð¿ÑƒÑˆ_Ð°ÐºÐ°_Ð¼Ð°Ð¹_Ã§Ä•Ñ€Ñ‚Ð¼Ðµ_ÑƒÑ‚Äƒ_Ã§ÑƒÑ€Ð»Ð°_Ð°Ð²ÄƒÐ½_ÑŽÐ¿Ð°_Ñ‡Ó³Ðº_Ñ€Ð°ÑˆÑ‚Ð°Ð²".split("_"),monthsShort:"ÐºÄƒÑ€_Ð½Ð°Ñ€_Ð¿ÑƒÑˆ_Ð°ÐºÐ°_Ð¼Ð°Ð¹_Ã§Ä•Ñ€_ÑƒÑ‚Äƒ_Ã§ÑƒÑ€_Ð°Ð²_ÑŽÐ¿Ð°_Ñ‡Ó³Ðº_Ñ€Ð°Ñˆ".split("_"),weekdays:"Ð²Ñ‹Ñ€ÑÐ°Ñ€Ð½Ð¸ÐºÑƒÐ½_Ñ‚ÑƒÐ½Ñ‚Ð¸ÐºÑƒÐ½_Ñ‹Ñ‚Ð»Ð°Ñ€Ð¸ÐºÑƒÐ½_ÑŽÐ½ÐºÑƒÐ½_ÐºÄ•Ã§Ð½ÐµÑ€Ð½Ð¸ÐºÑƒÐ½_ÑÑ€Ð½ÐµÐºÑƒÐ½_ÑˆÄƒÐ¼Ð°Ñ‚ÐºÑƒÐ½".split("_"),weekdaysShort:"Ð²Ñ‹Ñ€_Ñ‚ÑƒÐ½_Ñ‹Ñ‚Ð»_ÑŽÐ½_ÐºÄ•Ã§_ÑÑ€Ð½_ÑˆÄƒÐ¼".split("_"),weekdaysMin:"Ð²Ñ€_Ñ‚Ð½_Ñ‹Ñ‚_ÑŽÐ½_ÐºÃ§_ÑÑ€_ÑˆÐ¼".split("_"),longDateFormat:{LT:"HH:mm",L:"DD-MM-YYYY",LL:"YYYY [Ã§ÑƒÐ»Ñ…Ð¸] MMMM [ÑƒÐ¹ÄƒÑ…Ä•Ð½] D[-Ð¼Ä•ÑˆÄ•]",LLL:"YYYY [Ã§ÑƒÐ»Ñ…Ð¸] MMMM [ÑƒÐ¹ÄƒÑ…Ä•Ð½] D[-Ð¼Ä•ÑˆÄ•], LT",LLLL:"dddd, YYYY [Ã§ÑƒÐ»Ñ…Ð¸] MMMM [ÑƒÐ¹ÄƒÑ…Ä•Ð½] D[-Ð¼Ä•ÑˆÄ•], LT"},calendar:{sameDay:"[ÐŸÐ°ÑÐ½] LT [ÑÐµÑ…ÐµÑ‚Ñ€Ðµ]",nextDay:"[Ð«Ñ€Ð°Ð½] LT [ÑÐµÑ…ÐµÑ‚Ñ€Ðµ]",lastDay:"[Ä”Ð½ÐµÑ€] LT [ÑÐµÑ…ÐµÑ‚Ñ€Ðµ]",nextWeek:"[Ã‡Ð¸Ñ‚ÐµÑ] dddd LT [ÑÐµÑ…ÐµÑ‚Ñ€Ðµ]",lastWeek:"[Ð˜Ñ€Ñ‚Ð½Ä•] dddd LT [ÑÐµÑ…ÐµÑ‚Ñ€Ðµ]",sameElse:"L"},relativeTime:{future:function(a){var b=/ÑÐµÑ…ÐµÑ‚$/i.exec(a)?"Ñ€ÐµÐ½":/Ã§ÑƒÐ»$/i.exec(a)?"Ñ‚Ð°Ð½":"Ñ€Ð°Ð½";return a+b},past:"%s ÐºÐ°ÑÐ»Ð»Ð°",s:"Ð¿Ä•Ñ€-Ð¸Ðº Ã§ÐµÐºÐºÑƒÐ½Ñ‚",m:"Ð¿Ä•Ñ€ Ð¼Ð¸Ð½ÑƒÑ‚",mm:"%d Ð¼Ð¸Ð½ÑƒÑ‚",h:"Ð¿Ä•Ñ€ ÑÐµÑ…ÐµÑ‚",hh:"%d ÑÐµÑ…ÐµÑ‚",d:"Ð¿Ä•Ñ€ ÐºÑƒÐ½",dd:"%d ÐºÑƒÐ½",M:"Ð¿Ä•Ñ€ ÑƒÐ¹ÄƒÑ…",MM:"%d ÑƒÐ¹ÄƒÑ…",y:"Ð¿Ä•Ñ€ Ã§ÑƒÐ»",yy:"%d Ã§ÑƒÐ»"},ordinal:"%d-Ð¼Ä•Ñˆ",week:{dow:1,doy:7}})}),function(a){a(bb)}(function(a){return a.lang("cy",{months:"Ionawr_Chwefror_Mawrth_Ebrill_Mai_Mehefin_Gorffennaf_Awst_Medi_Hydref_Tachwedd_Rhagfyr".split("_"),monthsShort:"Ion_Chwe_Maw_Ebr_Mai_Meh_Gor_Aws_Med_Hyd_Tach_Rhag".split("_"),weekdays:"Dydd Sul_Dydd Llun_Dydd Mawrth_Dydd Mercher_Dydd Iau_Dydd Gwener_Dydd Sadwrn".split("_"),weekdaysShort:"Sul_Llun_Maw_Mer_Iau_Gwe_Sad".split("_"),weekdaysMin:"Su_Ll_Ma_Me_Ia_Gw_Sa".split("_"),longDateFormat:{LT:"HH:mm",L:"DD/MM/YYYY",LL:"D MMMM YYYY",LLL:"D MMMM YYYY LT",LLLL:"dddd, D MMMM YYYY LT"},calendar:{sameDay:"[Heddiw am] LT",nextDay:"[Yfory am] LT",nextWeek:"dddd [am] LT",lastDay:"[Ddoe am] LT",lastWeek:"dddd [diwethaf am] LT",sameElse:"L"},relativeTime:{future:"mewn %s",past:"%s yn &#244;l",s:"ychydig eiliadau",m:"munud",mm:"%d munud",h:"awr",hh:"%d awr",d:"diwrnod",dd:"%d diwrnod",M:"mis",MM:"%d mis",y:"blwyddyn",yy:"%d flynedd"},ordinal:function(a){var b=a,c="",d=["","af","il","ydd","ydd","ed","ed","ed","fed","fed","fed","eg","fed","eg","eg","fed","eg","eg","fed","eg","fed"];return b>20?c=40===b||50===b||60===b||80===b||100===b?"fed":"ain":b>0&&(c=d[b]),a+c},week:{dow:1,doy:4}})}),function(a){a(bb)}(function(a){return a.lang("da",{months:"januar_februar_marts_april_maj_juni_juli_august_september_oktober_november_december".split("_"),monthsShort:"jan_feb_mar_apr_maj_jun_jul_aug_sep_okt_nov_dec".split("_"),weekdays:"sÃ¸ndag_mandag_tirsdag_onsdag_torsdag_fredag_lÃ¸rdag".split("_"),weekdaysShort:"sÃ¸n_man_tir_ons_tor_fre_lÃ¸r".split("_"),weekdaysMin:"sÃ¸_ma_ti_on_to_fr_lÃ¸".split("_"),longDateFormat:{LT:"HH:mm",L:"DD/MM/YYYY",LL:"D MMMM YYYY",LLL:"D MMMM YYYY LT",LLLL:"dddd D. MMMM, YYYY LT"},calendar:{sameDay:"[I dag kl.] LT",nextDay:"[I morgen kl.] LT",nextWeek:"dddd [kl.] LT",lastDay:"[I gÃ¥r kl.] LT",lastWeek:"[sidste] dddd [kl] LT",sameElse:"L"},relativeTime:{future:"om %s",past:"%s siden",s:"fÃ¥ sekunder",m:"et minut",mm:"%d minutter",h:"en time",hh:"%d timer",d:"en dag",dd:"%d dage",M:"en mÃ¥ned",MM:"%d mÃ¥neder",y:"et Ã¥r",yy:"%d Ã¥r"},ordinal:"%d.",week:{dow:1,doy:4}})}),function(a){a(bb)}(function(a){function b(a,b,c){var d={m:["eine Minute","einer Minute"],h:["eine Stunde","einer Stunde"],d:["ein Tag","einem Tag"],dd:[a+" Tage",a+" Tagen"],M:["ein Monat","einem Monat"],MM:[a+" Monate",a+" Monaten"],y:["ein Jahr","einem Jahr"],yy:[a+" Jahre",a+" Jahren"]};return b?d[c][0]:d[c][1]}return a.lang("de",{months:"Januar_Februar_MÃ¤rz_April_Mai_Juni_Juli_August_September_Oktober_November_Dezember".split("_"),monthsShort:"Jan._Febr._Mrz._Apr._Mai_Jun._Jul._Aug._Sept._Okt._Nov._Dez.".split("_"),weekdays:"Sonntag_Montag_Dienstag_Mittwoch_Donnerstag_Freitag_Samstag".split("_"),weekdaysShort:"So._Mo._Di._Mi._Do._Fr._Sa.".split("_"),weekdaysMin:"So_Mo_Di_Mi_Do_Fr_Sa".split("_"),longDateFormat:{LT:"H:mm [Uhr]",L:"DD.MM.YYYY",LL:"D. MMMM YYYY",LLL:"D. MMMM YYYY LT",LLLL:"dddd, D. MMMM YYYY LT"},calendar:{sameDay:"[Heute um] LT",sameElse:"L",nextDay:"[Morgen um] LT",nextWeek:"dddd [um] LT",lastDay:"[Gestern um] LT",lastWeek:"[letzten] dddd [um] LT"},relativeTime:{future:"in %s",past:"vor %s",s:"ein paar Sekunden",m:b,mm:"%d Minuten",h:b,hh:"%d Stunden",d:b,dd:b,M:b,MM:b,y:b,yy:b},ordinal:"%d.",week:{dow:1,doy:4}})}),function(a){a(bb)}(function(a){return a.lang("el",{monthsNominativeEl:"Î™Î±Î½Î¿Ï…Î¬ÏÎ¹Î¿Ï‚_Î¦ÎµÎ²ÏÎ¿Ï…Î¬ÏÎ¹Î¿Ï‚_ÎœÎ¬ÏÏ„Î¹Î¿Ï‚_Î‘Ï€ÏÎ¯Î»Î¹Î¿Ï‚_ÎœÎ¬Î¹Î¿Ï‚_Î™Î¿ÏÎ½Î¹Î¿Ï‚_Î™Î¿ÏÎ»Î¹Î¿Ï‚_Î‘ÏÎ³Î¿Ï…ÏƒÏ„Î¿Ï‚_Î£ÎµÏ€Ï„Î­Î¼Î²ÏÎ¹Î¿Ï‚_ÎŸÎºÏ„ÏŽÎ²ÏÎ¹Î¿Ï‚_ÎÎ¿Î­Î¼Î²ÏÎ¹Î¿Ï‚_Î”ÎµÎºÎ­Î¼Î²ÏÎ¹Î¿Ï‚".split("_"),monthsGenitiveEl:"Î™Î±Î½Î¿Ï…Î±ÏÎ¯Î¿Ï…_Î¦ÎµÎ²ÏÎ¿Ï…Î±ÏÎ¯Î¿Ï…_ÎœÎ±ÏÏ„Î¯Î¿Ï…_Î‘Ï€ÏÎ¹Î»Î¯Î¿Ï…_ÎœÎ±ÎÎ¿Ï…_Î™Î¿Ï…Î½Î¯Î¿Ï…_Î™Î¿Ï…Î»Î¯Î¿Ï…_Î‘Ï…Î³Î¿ÏÏƒÏ„Î¿Ï…_Î£ÎµÏ€Ï„ÎµÎ¼Î²ÏÎ¯Î¿Ï…_ÎŸÎºÏ„Ï‰Î²ÏÎ¯Î¿Ï…_ÎÎ¿ÎµÎ¼Î²ÏÎ¯Î¿Ï…_Î”ÎµÎºÎµÎ¼Î²ÏÎ¯Î¿Ï…".split("_"),months:function(a,b){return/D/.test(b.substring(0,b.indexOf("MMMM")))?this._monthsGenitiveEl[a.month()]:this._monthsNominativeEl[a.month()]},monthsShort:"Î™Î±Î½_Î¦ÎµÎ²_ÎœÎ±Ï_Î‘Ï€Ï_ÎœÎ±ÏŠ_Î™Î¿Ï…Î½_Î™Î¿Ï…Î»_Î‘Ï…Î³_Î£ÎµÏ€_ÎŸÎºÏ„_ÎÎ¿Îµ_Î”ÎµÎº".split("_"),weekdays:"ÎšÏ…ÏÎ¹Î±ÎºÎ®_Î”ÎµÏ…Ï„Î­ÏÎ±_Î¤ÏÎ¯Ï„Î·_Î¤ÎµÏ„Î¬ÏÏ„Î·_Î Î­Î¼Ï€Ï„Î·_Î Î±ÏÎ±ÏƒÎºÎµÏ…Î®_Î£Î¬Î²Î²Î±Ï„Î¿".split("_"),weekdaysShort:"ÎšÏ…Ï_Î”ÎµÏ…_Î¤ÏÎ¹_Î¤ÎµÏ„_Î ÎµÎ¼_Î Î±Ï_Î£Î±Î²".split("_"),weekdaysMin:"ÎšÏ…_Î”Îµ_Î¤Ï_Î¤Îµ_Î Îµ_Î Î±_Î£Î±".split("_"),meridiem:function(a,b,c){return a>11?c?"Î¼Î¼":"ÎœÎœ":c?"Ï€Î¼":"Î Îœ"},longDateFormat:{LT:"h:mm A",L:"DD/MM/YYYY",LL:"D MMMM YYYY",LLL:"D MMMM YYYY LT",LLLL:"dddd, D MMMM YYYY LT"},calendarEl:{sameDay:"[Î£Î®Î¼ÎµÏÎ± {}] LT",nextDay:"[Î‘ÏÏÎ¹Î¿ {}] LT",nextWeek:"dddd [{}] LT",lastDay:"[Î§Î¸ÎµÏ‚ {}] LT",lastWeek:"[Ï„Î·Î½ Ï€ÏÎ¿Î·Î³Î¿ÏÎ¼ÎµÎ½Î·] dddd [{}] LT",sameElse:"L"},calendar:function(a,b){var c=this._calendarEl[a],d=b&&b.hours();return c.replace("{}",1===d%12?"ÏƒÏ„Î·":"ÏƒÏ„Î¹Ï‚")},relativeTime:{future:"ÏƒÎµ %s",past:"%s Ï€ÏÎ¹Î½",s:"Î´ÎµÏ…Ï„ÎµÏÏŒÎ»ÎµÏ€Ï„Î±",m:"Î­Î½Î± Î»ÎµÏ€Ï„ÏŒ",mm:"%d Î»ÎµÏ€Ï„Î¬",h:"Î¼Î¯Î± ÏŽÏÎ±",hh:"%d ÏŽÏÎµÏ‚",d:"Î¼Î¯Î± Î¼Î­ÏÎ±",dd:"%d Î¼Î­ÏÎµÏ‚",M:"Î­Î½Î±Ï‚ Î¼Î®Î½Î±Ï‚",MM:"%d Î¼Î®Î½ÎµÏ‚",y:"Î­Î½Î±Ï‚ Ï‡ÏÏŒÎ½Î¿Ï‚",yy:"%d Ï‡ÏÏŒÎ½Î¹Î±"},ordinal:function(a){return a+"Î·"},week:{dow:1,doy:4}})}),function(a){a(bb)}(function(a){return a.lang("en-au",{months:"January_February_March_April_May_June_July_August_September_October_November_December".split("_"),monthsShort:"Jan_Feb_Mar_Apr_May_Jun_Jul_Aug_Sep_Oct_Nov_Dec".split("_"),weekdays:"Sunday_Monday_Tuesday_Wednesday_Thursday_Friday_Saturday".split("_"),weekdaysShort:"Sun_Mon_Tue_Wed_Thu_Fri_Sat".split("_"),weekdaysMin:"Su_Mo_Tu_We_Th_Fr_Sa".split("_"),longDateFormat:{LT:"h:mm A",L:"DD/MM/YYYY",LL:"D MMMM YYYY",LLL:"D MMMM YYYY LT",LLLL:"dddd, D MMMM YYYY LT"},calendar:{sameDay:"[Today at] LT",nextDay:"[Tomorrow at] LT",nextWeek:"dddd [at] LT",lastDay:"[Yesterday at] LT",lastWeek:"[Last] dddd [at] LT",sameElse:"L"},relativeTime:{future:"in %s",past:"%s ago",s:"a few seconds",m:"a minute",mm:"%d minutes",h:"an hour",hh:"%d hours",d:"a day",dd:"%d days",M:"a month",MM:"%d months",y:"a year",yy:"%d years"},ordinal:function(a){var b=a%10,c=1===~~(a%100/10)?"th":1===b?"st":2===b?"nd":3===b?"rd":"th";return a+c},week:{dow:1,doy:4}})}),function(a){a(bb)}(function(a){return a.lang("en-ca",{months:"January_February_March_April_May_June_July_August_September_October_November_December".split("_"),monthsShort:"Jan_Feb_Mar_Apr_May_Jun_Jul_Aug_Sep_Oct_Nov_Dec".split("_"),weekdays:"Sunday_Monday_Tuesday_Wednesday_Thursday_Friday_Saturday".split("_"),weekdaysShort:"Sun_Mon_Tue_Wed_Thu_Fri_Sat".split("_"),weekdaysMin:"Su_Mo_Tu_We_Th_Fr_Sa".split("_"),longDateFormat:{LT:"h:mm A",L:"YYYY-MM-DD",LL:"D MMMM, YYYY",LLL:"D MMMM, YYYY LT",LLLL:"dddd, D MMMM, YYYY LT"},calendar:{sameDay:"[Today at] LT",nextDay:"[Tomorrow at] LT",nextWeek:"dddd [at] LT",lastDay:"[Yesterday at] LT",lastWeek:"[Last] dddd [at] LT",sameElse:"L"},relativeTime:{future:"in %s",past:"%s ago",s:"a few seconds",m:"a minute",mm:"%d minutes",h:"an hour",hh:"%d hours",d:"a day",dd:"%d days",M:"a month",MM:"%d months",y:"a year",yy:"%d years"},ordinal:function(a){var b=a%10,c=1===~~(a%100/10)?"th":1===b?"st":2===b?"nd":3===b?"rd":"th";return a+c}})}),function(a){a(bb)}(function(a){return a.lang("en-gb",{months:"January_February_March_April_May_June_July_August_September_October_November_December".split("_"),monthsShort:"Jan_Feb_Mar_Apr_May_Jun_Jul_Aug_Sep_Oct_Nov_Dec".split("_"),weekdays:"Sunday_Monday_Tuesday_Wednesday_Thursday_Friday_Saturday".split("_"),weekdaysShort:"Sun_Mon_Tue_Wed_Thu_Fri_Sat".split("_"),weekdaysMin:"Su_Mo_Tu_We_Th_Fr_Sa".split("_"),longDateFormat:{LT:"HH:mm",L:"DD/MM/YYYY",LL:"D MMMM YYYY",LLL:"D MMMM YYYY LT",LLLL:"dddd, D MMMM YYYY LT"},calendar:{sameDay:"[Today at] LT",nextDay:"[Tomorrow at] LT",nextWeek:"dddd [at] LT",lastDay:"[Yesterday at] LT",lastWeek:"[Last] dddd [at] LT",sameElse:"L"},relativeTime:{future:"in %s",past:"%s ago",s:"a few seconds",m:"a minute",mm:"%d minutes",h:"an hour",hh:"%d hours",d:"a day",dd:"%d days",M:"a month",MM:"%d months",y:"a year",yy:"%d years"},ordinal:function(a){var b=a%10,c=1===~~(a%100/10)?"th":1===b?"st":2===b?"nd":3===b?"rd":"th";return a+c},week:{dow:1,doy:4}})}),function(a){a(bb)}(function(a){return a.lang("eo",{months:"januaro_februaro_marto_aprilo_majo_junio_julio_aÅ­gusto_septembro_oktobro_novembro_decembro".split("_"),monthsShort:"jan_feb_mar_apr_maj_jun_jul_aÅ­g_sep_okt_nov_dec".split("_"),weekdays:"DimanÄ‰o_Lundo_Mardo_Merkredo_Ä´aÅ­do_Vendredo_Sabato".split("_"),weekdaysShort:"Dim_Lun_Mard_Merk_Ä´aÅ­_Ven_Sab".split("_"),weekdaysMin:"Di_Lu_Ma_Me_Ä´a_Ve_Sa".split("_"),longDateFormat:{LT:"HH:mm",L:"YYYY-MM-DD",LL:"D[-an de] MMMM, YYYY",LLL:"D[-an de] MMMM, YYYY LT",LLLL:"dddd, [la] D[-an de] MMMM, YYYY LT"},meridiem:function(a,b,c){return a>11?c?"p.t.m.":"P.T.M.":c?"a.t.m.":"A.T.M."},calendar:{sameDay:"[HodiaÅ­ je] LT",nextDay:"[MorgaÅ­ je] LT",nextWeek:"dddd [je] LT",lastDay:"[HieraÅ­ je] LT",lastWeek:"[pasinta] dddd [je] LT",sameElse:"L"},relativeTime:{future:"je %s",past:"antaÅ­ %s",s:"sekundoj",m:"minuto",mm:"%d minutoj",h:"horo",hh:"%d horoj",d:"tago",dd:"%d tagoj",M:"monato",MM:"%d monatoj",y:"jaro",yy:"%d jaroj"},ordinal:"%da",week:{dow:1,doy:7}})}),function(a){a(bb)}(function(a){return a.lang("es",{months:"enero_febrero_marzo_abril_mayo_junio_julio_agosto_septiembre_octubre_noviembre_diciembre".split("_"),monthsShort:"ene._feb._mar._abr._may._jun._jul._ago._sep._oct._nov._dic.".split("_"),weekdays:"domingo_lunes_martes_miÃ©rcoles_jueves_viernes_sÃ¡bado".split("_"),weekdaysShort:"dom._lun._mar._miÃ©._jue._vie._sÃ¡b.".split("_"),weekdaysMin:"Do_Lu_Ma_Mi_Ju_Vi_SÃ¡".split("_"),longDateFormat:{LT:"H:mm",L:"DD/MM/YYYY",LL:"D [de] MMMM [de] YYYY",LLL:"D [de] MMMM [de] YYYY LT",LLLL:"dddd, D [de] MMMM [de] YYYY LT"},calendar:{sameDay:function(){return"[hoy a la"+(1!==this.hours()?"s":"")+"] LT"},nextDay:function(){return"[maÃ±ana a la"+(1!==this.hours()?"s":"")+"] LT"},nextWeek:function(){return"dddd [a la"+(1!==this.hours()?"s":"")+"] LT"},lastDay:function(){return"[ayer a la"+(1!==this.hours()?"s":"")+"] LT"},lastWeek:function(){return"[el] dddd [pasado a la"+(1!==this.hours()?"s":"")+"] LT"},sameElse:"L"},relativeTime:{future:"en %s",past:"hace %s",s:"unos segundos",m:"un minuto",mm:"%d minutos",h:"una hora",hh:"%d horas",d:"un dÃ­a",dd:"%d dÃ­as",M:"un mes",MM:"%d meses",y:"un aÃ±o",yy:"%d aÃ±os"},ordinal:"%d",week:{dow:1,doy:4}})}),function(a){a(bb)}(function(a){function b(a,b,c,d){return d||b?"paari sekundi":"paar sekundit"}return a.lang("et",{months:"jaanuar_veebruar_mÃ¤rts_aprill_mai_juuni_juuli_august_september_oktoober_november_detsember".split("_"),monthsShort:"jaan_veebr_mÃ¤rts_apr_mai_juuni_juuli_aug_sept_okt_nov_dets".split("_"),weekdays:"pÃ¼hapÃ¤ev_esmaspÃ¤ev_teisipÃ¤ev_kolmapÃ¤ev_neljapÃ¤ev_reede_laupÃ¤ev".split("_"),weekdaysShort:"P_E_T_K_N_R_L".split("_"),weekdaysMin:"P_E_T_K_N_R_L".split("_"),longDateFormat:{LT:"H:mm",L:"DD.MM.YYYY",LL:"D. MMMM YYYY",LLL:"D. MMMM YYYY LT",LLLL:"dddd, D. MMMM YYYY LT"},calendar:{sameDay:"[TÃ¤na,] LT",nextDay:"[Homme,] LT",nextWeek:"[JÃ¤rgmine] dddd LT",lastDay:"[Eile,] LT",lastWeek:"[Eelmine] dddd LT",sameElse:"L"},relativeTime:{future:"%s pÃ¤rast",past:"%s tagasi",s:b,m:"minut",mm:"%d minutit",h:"tund",hh:"%d tundi",d:"pÃ¤ev",dd:"%d pÃ¤eva",M:"kuu",MM:"%d kuud",y:"aasta",yy:"%d aastat"},ordinal:"%d.",week:{dow:1,doy:4}})}),function(a){a(bb)}(function(a){return a.lang("eu",{months:"urtarrila_otsaila_martxoa_apirila_maiatza_ekaina_uztaila_abuztua_iraila_urria_azaroa_abendua".split("_"),monthsShort:"urt._ots._mar._api._mai._eka._uzt._abu._ira._urr._aza._abe.".split("_"),weekdays:"igandea_astelehena_asteartea_asteazkena_osteguna_ostirala_larunbata".split("_"),weekdaysShort:"ig._al._ar._az._og._ol._lr.".split("_"),weekdaysMin:"ig_al_ar_az_og_ol_lr".split("_"),longDateFormat:{LT:"HH:mm",L:"YYYY-MM-DD",LL:"YYYY[ko] MMMM[ren] D[a]",LLL:"YYYY[ko] MMMM[ren] D[a] LT",LLLL:"dddd, YYYY[ko] MMMM[ren] D[a] LT",l:"YYYY-M-D",ll:"YYYY[ko] MMM D[a]",lll:"YYYY[ko] MMM D[a] LT",llll:"ddd, YYYY[ko] MMM D[a] LT"},calendar:{sameDay:"[gaur] LT[etan]",nextDay:"[bihar] LT[etan]",nextWeek:"dddd LT[etan]",lastDay:"[atzo] LT[etan]",lastWeek:"[aurreko] dddd LT[etan]",sameElse:"L"},relativeTime:{future:"%s barru",past:"duela %s",s:"segundo batzuk",m:"minutu bat",mm:"%d minutu",h:"ordu bat",hh:"%d ordu",d:"egun bat",dd:"%d egun",M:"hilabete bat",MM:"%d hilabete",y:"urte bat",yy:"%d urte"},ordinal:"%d.",week:{dow:1,doy:7}})}),function(a){a(bb)}(function(a){var b={1:"Û±",2:"Û²",3:"Û³",4:"Û´",5:"Ûµ",6:"Û¶",7:"Û·",8:"Û¸",9:"Û¹",0:"Û°"},c={"Û±":"1","Û²":"2","Û³":"3","Û´":"4","Ûµ":"5","Û¶":"6","Û·":"7","Û¸":"8","Û¹":"9","Û°":"0"};return a.lang("fa",{months:"Ú˜Ø§Ù†ÙˆÛŒÙ‡_ÙÙˆØ±ÛŒÙ‡_Ù…Ø§Ø±Ø³_Ø¢ÙˆØ±ÛŒÙ„_Ù…Ù‡_Ú˜ÙˆØ¦Ù†_Ú˜ÙˆØ¦ÛŒÙ‡_Ø§ÙˆØª_Ø³Ù¾ØªØ§Ù…Ø¨Ø±_Ø§Ú©ØªØ¨Ø±_Ù†ÙˆØ§Ù…Ø¨Ø±_Ø¯Ø³Ø§Ù…Ø¨Ø±".split("_"),monthsShort:"Ú˜Ø§Ù†ÙˆÛŒÙ‡_ÙÙˆØ±ÛŒÙ‡_Ù…Ø§Ø±Ø³_Ø¢ÙˆØ±ÛŒÙ„_Ù…Ù‡_Ú˜ÙˆØ¦Ù†_Ú˜ÙˆØ¦ÛŒÙ‡_Ø§ÙˆØª_Ø³Ù¾ØªØ§Ù…Ø¨Ø±_Ø§Ú©ØªØ¨Ø±_Ù†ÙˆØ§Ù…Ø¨Ø±_Ø¯Ø³Ø§Ù…Ø¨Ø±".split("_"),weekdays:"ÛŒÚ©â€ŒØ´Ù†Ø¨Ù‡_Ø¯ÙˆØ´Ù†Ø¨Ù‡_Ø³Ù‡â€ŒØ´Ù†Ø¨Ù‡_Ú†Ù‡Ø§Ø±Ø´Ù†Ø¨Ù‡_Ù¾Ù†Ø¬â€ŒØ´Ù†Ø¨Ù‡_Ø¬Ù…Ø¹Ù‡_Ø´Ù†Ø¨Ù‡".split("_"),weekdaysShort:"ÛŒÚ©â€ŒØ´Ù†Ø¨Ù‡_Ø¯ÙˆØ´Ù†Ø¨Ù‡_Ø³Ù‡â€ŒØ´Ù†Ø¨Ù‡_Ú†Ù‡Ø§Ø±Ø´Ù†Ø¨Ù‡_Ù¾Ù†Ø¬â€ŒØ´Ù†Ø¨Ù‡_Ø¬Ù…Ø¹Ù‡_Ø´Ù†Ø¨Ù‡".split("_"),weekdaysMin:"ÛŒ_Ø¯_Ø³_Ú†_Ù¾_Ø¬_Ø´".split("_"),longDateFormat:{LT:"HH:mm",L:"DD/MM/YYYY",LL:"D MMMM YYYY",LLL:"D MMMM YYYY LT",LLLL:"dddd, D MMMM YYYY LT"},meridiem:function(a){return 12>a?"Ù‚Ø¨Ù„ Ø§Ø² Ø¸Ù‡Ø±":"Ø¨Ø¹Ø¯ Ø§Ø² Ø¸Ù‡Ø±"},calendar:{sameDay:"[Ø§Ù…Ø±ÙˆØ² Ø³Ø§Ø¹Øª] LT",nextDay:"[ÙØ±Ø¯Ø§ Ø³Ø§Ø¹Øª] LT",nextWeek:"dddd [Ø³Ø§Ø¹Øª] LT",lastDay:"[Ø¯ÛŒØ±ÙˆØ² Ø³Ø§Ø¹Øª] LT",lastWeek:"dddd [Ù¾ÛŒØ´] [Ø³Ø§Ø¹Øª] LT",sameElse:"L"},relativeTime:{future:"Ø¯Ø± %s",past:"%s Ù¾ÛŒØ´",s:"Ú†Ù†Ø¯ÛŒÙ† Ø«Ø§Ù†ÛŒÙ‡",m:"ÛŒÚ© Ø¯Ù‚ÛŒÙ‚Ù‡",mm:"%d Ø¯Ù‚ÛŒÙ‚Ù‡",h:"ÛŒÚ© Ø³Ø§Ø¹Øª",hh:"%d Ø³Ø§Ø¹Øª",d:"ÛŒÚ© Ø±ÙˆØ²",dd:"%d Ø±ÙˆØ²",M:"ÛŒÚ© Ù…Ø§Ù‡",MM:"%d Ù…Ø§Ù‡",y:"ÛŒÚ© Ø³Ø§Ù„",yy:"%d Ø³Ø§Ù„"},preparse:function(a){return a.replace(/[Û°-Û¹]/g,function(a){return c[a]}).replace(/ØŒ/g,",")},postformat:function(a){return a.replace(/\d/g,function(a){return b[a]}).replace(/,/g,"ØŒ")},ordinal:"%dÙ…",week:{dow:6,doy:12}})}),function(a){a(bb)}(function(a){function b(a,b,d,e){var f="";switch(d){case"s":return e?"muutaman sekunnin":"muutama sekunti";case"m":return e?"minuutin":"minuutti";case"mm":f=e?"minuutin":"minuuttia";break;case"h":return e?"tunnin":"tunti";case"hh":f=e?"tunnin":"tuntia";break;case"d":return e?"pÃ¤ivÃ¤n":"pÃ¤ivÃ¤";case"dd":f=e?"pÃ¤ivÃ¤n":"pÃ¤ivÃ¤Ã¤";break;case"M":return e?"kuukauden":"kuukausi";case"MM":f=e?"kuukauden":"kuukautta";break;case"y":return e?"vuoden":"vuosi";case"yy":f=e?"vuoden":"vuotta"}return f=c(a,e)+" "+f}function c(a,b){return 10>a?b?e[a]:d[a]:a}var d="nolla yksi kaksi kolme neljÃ¤ viisi kuusi seitsemÃ¤n kahdeksan yhdeksÃ¤n".split(" "),e=["nolla","yhden","kahden","kolmen","neljÃ¤n","viiden","kuuden",d[7],d[8],d[9]];return a.lang("fi",{months:"tammikuu_helmikuu_maaliskuu_huhtikuu_toukokuu_kesÃ¤kuu_heinÃ¤kuu_elokuu_syyskuu_lokakuu_marraskuu_joulukuu".split("_"),monthsShort:"tammi_helmi_maalis_huhti_touko_kesÃ¤_heinÃ¤_elo_syys_loka_marras_joulu".split("_"),weekdays:"sunnuntai_maanantai_tiistai_keskiviikko_torstai_perjantai_lauantai".split("_"),weekdaysShort:"su_ma_ti_ke_to_pe_la".split("_"),weekdaysMin:"su_ma_ti_ke_to_pe_la".split("_"),longDateFormat:{LT:"HH.mm",L:"DD.MM.YYYY",LL:"Do MMMM[ta] YYYY",LLL:"Do MMMM[ta] YYYY, [klo] LT",LLLL:"dddd, Do MMMM[ta] YYYY, [klo] LT",l:"D.M.YYYY",ll:"Do MMM YYYY",lll:"Do MMM YYYY, [klo] LT",llll:"ddd, Do MMM YYYY, [klo] LT"},calendar:{sameDay:"[tÃ¤nÃ¤Ã¤n] [klo] LT",nextDay:"[huomenna] [klo] LT",nextWeek:"dddd [klo] LT",lastDay:"[eilen] [klo] LT",lastWeek:"[viime] dddd[na] [klo] LT",sameElse:"L"},relativeTime:{future:"%s pÃ¤Ã¤stÃ¤",past:"%s sitten",s:b,m:b,mm:b,h:b,hh:b,d:b,dd:b,M:b,MM:b,y:b,yy:b},ordinal:"%d.",week:{dow:1,doy:4}})}),function(a){a(bb)}(function(a){return a.lang("fo",{months:"januar_februar_mars_aprÃ­l_mai_juni_juli_august_september_oktober_november_desember".split("_"),monthsShort:"jan_feb_mar_apr_mai_jun_jul_aug_sep_okt_nov_des".split("_"),weekdays:"sunnudagur_mÃ¡nadagur_tÃ½sdagur_mikudagur_hÃ³sdagur_frÃ­ggjadagur_leygardagur".split("_"),weekdaysShort:"sun_mÃ¡n_tÃ½s_mik_hÃ³s_frÃ­_ley".split("_"),weekdaysMin:"su_mÃ¡_tÃ½_mi_hÃ³_fr_le".split("_"),longDateFormat:{LT:"HH:mm",L:"DD/MM/YYYY",LL:"D MMMM YYYY",LLL:"D MMMM YYYY LT",LLLL:"dddd D. MMMM, YYYY LT"},calendar:{sameDay:"[Ã dag kl.] LT",nextDay:"[Ã morgin kl.] LT",nextWeek:"dddd [kl.] LT",lastDay:"[Ã gjÃ¡r kl.] LT",lastWeek:"[sÃ­Ã°stu] dddd [kl] LT",sameElse:"L"},relativeTime:{future:"um %s",past:"%s sÃ­Ã°ani",s:"fÃ¡ sekund",m:"ein minutt",mm:"%d minuttir",h:"ein tÃ­mi",hh:"%d tÃ­mar",d:"ein dagur",dd:"%d dagar",M:"ein mÃ¡naÃ°i",MM:"%d mÃ¡naÃ°ir",y:"eitt Ã¡r",yy:"%d Ã¡r"},ordinal:"%d.",week:{dow:1,doy:4}})}),function(a){a(bb)}(function(a){return a.lang("fr-ca",{months:"janvier_fÃ©vrier_mars_avril_mai_juin_juillet_aoÃ»t_septembre_octobre_novembre_dÃ©cembre".split("_"),monthsShort:"janv._fÃ©vr._mars_avr._mai_juin_juil._aoÃ»t_sept._oct._nov._dÃ©c.".split("_"),weekdays:"dimanche_lundi_mardi_mercredi_jeudi_vendredi_samedi".split("_"),weekdaysShort:"dim._lun._mar._mer._jeu._ven._sam.".split("_"),weekdaysMin:"Di_Lu_Ma_Me_Je_Ve_Sa".split("_"),longDateFormat:{LT:"HH:mm",L:"YYYY-MM-DD",LL:"D MMMM YYYY",LLL:"D MMMM YYYY LT",LLLL:"dddd D MMMM YYYY LT"},calendar:{sameDay:"[Aujourd'hui Ã ] LT",nextDay:"[Demain Ã ] LT",nextWeek:"dddd [Ã ] LT",lastDay:"[Hier Ã ] LT",lastWeek:"dddd [dernier Ã ] LT",sameElse:"L"},relativeTime:{future:"dans %s",past:"il y a %s",s:"quelques secondes",m:"une minute",mm:"%d minutes",h:"une heure",hh:"%d heures",d:"un jour",dd:"%d jours",M:"un mois",MM:"%d mois",y:"un an",yy:"%d ans"},ordinal:function(a){return a+(1===a?"er":"")}})}),function(a){a(bb)}(function(a){return a.lang("fr",{months:"janvier_fÃ©vrier_mars_avril_mai_juin_juillet_aoÃ»t_septembre_octobre_novembre_dÃ©cembre".split("_"),monthsShort:"janv._fÃ©vr._mars_avr._mai_juin_juil._aoÃ»t_sept._oct._nov._dÃ©c.".split("_"),weekdays:"dimanche_lundi_mardi_mercredi_jeudi_vendredi_samedi".split("_"),weekdaysShort:"dim._lun._mar._mer._jeu._ven._sam.".split("_"),weekdaysMin:"Di_Lu_Ma_Me_Je_Ve_Sa".split("_"),longDateFormat:{LT:"HH:mm",L:"DD/MM/YYYY",LL:"D MMMM YYYY",LLL:"D MMMM YYYY LT",LLLL:"dddd D MMMM YYYY LT"},calendar:{sameDay:"[Aujourd'hui Ã ] LT",nextDay:"[Demain Ã ] LT",nextWeek:"dddd [Ã ] LT",lastDay:"[Hier Ã ] LT",lastWeek:"dddd [dernier Ã ] LT",sameElse:"L"},relativeTime:{future:"dans %s",past:"il y a %s",s:"quelques secondes",m:"une minute",mm:"%d minutes",h:"une heure",hh:"%d heures",d:"un jour",dd:"%d jours",M:"un mois",MM:"%d mois",y:"un an",yy:"%d ans"},ordinal:function(a){return a+(1===a?"er":"")},week:{dow:1,doy:4}})}),function(a){a(bb)}(function(a){return a.lang("gl",{months:"Xaneiro_Febreiro_Marzo_Abril_Maio_XuÃ±o_Xullo_Agosto_Setembro_Outubro_Novembro_Decembro".split("_"),monthsShort:"Xan._Feb._Mar._Abr._Mai._XuÃ±._Xul._Ago._Set._Out._Nov._Dec.".split("_"),weekdays:"Domingo_Luns_Martes_MÃ©rcores_Xoves_Venres_SÃ¡bado".split("_"),weekdaysShort:"Dom._Lun._Mar._MÃ©r._Xov._Ven._SÃ¡b.".split("_"),weekdaysMin:"Do_Lu_Ma_MÃ©_Xo_Ve_SÃ¡".split("_"),longDateFormat:{LT:"H:mm",L:"DD/MM/YYYY",LL:"D MMMM YYYY",LLL:"D MMMM YYYY LT",LLLL:"dddd D MMMM YYYY LT"},calendar:{sameDay:function(){return"[hoxe "+(1!==this.hours()?"Ã¡s":"Ã¡")+"] LT"},nextDay:function(){return"[maÃ±Ã¡ "+(1!==this.hours()?"Ã¡s":"Ã¡")+"] LT"},nextWeek:function(){return"dddd ["+(1!==this.hours()?"Ã¡s":"a")+"] LT"},lastDay:function(){return"[onte "+(1!==this.hours()?"Ã¡":"a")+"] LT"},lastWeek:function(){return"[o] dddd [pasado "+(1!==this.hours()?"Ã¡s":"a")+"] LT"},sameElse:"L"},relativeTime:{future:function(a){return"uns segundos"===a?"nuns segundos":"en "+a},past:"hai %s",s:"uns segundos",m:"un minuto",mm:"%d minutos",h:"unha hora",hh:"%d horas",d:"un dÃ­a",dd:"%d dÃ­as",M:"un mes",MM:"%d meses",y:"un ano",yy:"%d anos"},ordinal:"%d",week:{dow:1,doy:7}})}),function(a){a(bb)}(function(a){return a.lang("he",{months:"×™× ×•××¨_×¤×‘×¨×•××¨_×ž×¨×¥_××¤×¨×™×œ_×ž××™_×™×•× ×™_×™×•×œ×™_××•×’×•×¡×˜_×¡×¤×˜×ž×‘×¨_××•×§×˜×•×‘×¨_× ×•×‘×ž×‘×¨_×“×¦×ž×‘×¨".split("_"),monthsShort:"×™× ×•×³_×¤×‘×¨×³_×ž×¨×¥_××¤×¨×³_×ž××™_×™×•× ×™_×™×•×œ×™_××•×’×³_×¡×¤×˜×³_××•×§×³_× ×•×‘×³_×“×¦×ž×³".split("_"),weekdays:"×¨××©×•×Ÿ_×©× ×™_×©×œ×™×©×™_×¨×‘×™×¢×™_×—×ž×™×©×™_×©×™×©×™_×©×‘×ª".split("_"),weekdaysShort:"××³_×‘×³_×’×³_×“×³_×”×³_×•×³_×©×³".split("_"),weekdaysMin:"×_×‘_×’_×“_×”_×•_×©".split("_"),longDateFormat:{LT:"HH:mm",L:"DD/MM/YYYY",LL:"D [×‘]MMMM YYYY",LLL:"D [×‘]MMMM YYYY LT",LLLL:"dddd, D [×‘]MMMM YYYY LT",l:"D/M/YYYY",ll:"D MMM YYYY",lll:"D MMM YYYY LT",llll:"ddd, D MMM YYYY LT"},calendar:{sameDay:"[×”×™×•× ×‘Ö¾]LT",nextDay:"[×ž×—×¨ ×‘Ö¾]LT",nextWeek:"dddd [×‘×©×¢×”] LT",lastDay:"[××ª×ž×•×œ ×‘Ö¾]LT",lastWeek:"[×‘×™×•×] dddd [×”××—×¨×•×Ÿ ×‘×©×¢×”] LT",sameElse:"L"},relativeTime:{future:"×‘×¢×•×“ %s",past:"×œ×¤× ×™ %s",s:"×ž×¡×¤×¨ ×©× ×™×•×ª",m:"×“×§×”",mm:"%d ×“×§×•×ª",h:"×©×¢×”",hh:function(a){return 2===a?"×©×¢×ª×™×™×":a+" ×©×¢×•×ª"},d:"×™×•×",dd:function(a){return 2===a?"×™×•×ž×™×™×":a+" ×™×ž×™×"},M:"×—×•×“×©",MM:function(a){return 2===a?"×—×•×“×©×™×™×":a+" ×—×•×“×©×™×"},y:"×©× ×”",yy:function(a){return 2===a?"×©× ×ª×™×™×":a+" ×©× ×™×"}}})}),function(a){a(bb)}(function(a){var b={1:"à¥§",2:"à¥¨",3:"à¥©",4:"à¥ª",5:"à¥«",6:"à¥¬",7:"à¥­",8:"à¥®",9:"à¥¯",0:"à¥¦"},c={"à¥§":"1","à¥¨":"2","à¥©":"3","à¥ª":"4","à¥«":"5","à¥¬":"6","à¥­":"7","à¥®":"8","à¥¯":"9","à¥¦":"0"};return a.lang("hi",{months:"à¤œà¤¨à¤µà¤°à¥€_à¤«à¤¼à¤°à¤µà¤°à¥€_à¤®à¤¾à¤°à¥à¤š_à¤…à¤ªà¥à¤°à¥ˆà¤²_à¤®à¤ˆ_à¤œà¥‚à¤¨_à¤œà¥à¤²à¤¾à¤ˆ_à¤…à¤—à¤¸à¥à¤¤_à¤¸à¤¿à¤¤à¤®à¥à¤¬à¤°_à¤…à¤•à¥à¤Ÿà¥‚à¤¬à¤°_à¤¨à¤µà¤®à¥à¤¬à¤°_à¤¦à¤¿à¤¸à¤®à¥à¤¬à¤°".split("_"),monthsShort:"à¤œà¤¨._à¤«à¤¼à¤°._à¤®à¤¾à¤°à¥à¤š_à¤…à¤ªà¥à¤°à¥ˆ._à¤®à¤ˆ_à¤œà¥‚à¤¨_à¤œà¥à¤²._à¤…à¤—._à¤¸à¤¿à¤¤._à¤…à¤•à¥à¤Ÿà¥‚._à¤¨à¤µ._à¤¦à¤¿à¤¸.".split("_"),weekdays:"à¤°à¤µà¤¿à¤µà¤¾à¤°_à¤¸à¥‹à¤®à¤µà¤¾à¤°_à¤®à¤‚à¤—à¤²à¤µà¤¾à¤°_à¤¬à¥à¤§à¤µà¤¾à¤°_à¤—à¥à¤°à¥‚à¤µà¤¾à¤°_à¤¶à¥à¤•à¥à¤°à¤µà¤¾à¤°_à¤¶à¤¨à¤¿à¤µà¤¾à¤°".split("_"),weekdaysShort:"à¤°à¤µà¤¿_à¤¸à¥‹à¤®_à¤®à¤‚à¤—à¤²_à¤¬à¥à¤§_à¤—à¥à¤°à¥‚_à¤¶à¥à¤•à¥à¤°_à¤¶à¤¨à¤¿".split("_"),weekdaysMin:"à¤°_à¤¸à¥‹_à¤®à¤‚_à¤¬à¥_à¤—à¥_à¤¶à¥_à¤¶".split("_"),longDateFormat:{LT:"A h:mm à¤¬à¤œà¥‡",L:"DD/MM/YYYY",LL:"D MMMM YYYY",LLL:"D MMMM YYYY, LT",LLLL:"dddd, D MMMM YYYY, LT"},calendar:{sameDay:"[à¤†à¤œ] LT",nextDay:"[à¤•à¤²] LT",nextWeek:"dddd, LT",lastDay:"[à¤•à¤²] LT",lastWeek:"[à¤ªà¤¿à¤›à¤²à¥‡] dddd, LT",sameElse:"L"},relativeTime:{future:"%s à¤®à¥‡à¤‚",past:"%s à¤ªà¤¹à¤²à¥‡",s:"à¤•à¥à¤› à¤¹à¥€ à¤•à¥à¤·à¤£",m:"à¤à¤• à¤®à¤¿à¤¨à¤Ÿ",mm:"%d à¤®à¤¿à¤¨à¤Ÿ",h:"à¤à¤• à¤˜à¤‚à¤Ÿà¤¾",hh:"%d à¤˜à¤‚à¤Ÿà¥‡",d:"à¤à¤• à¤¦à¤¿à¤¨",dd:"%d à¤¦à¤¿à¤¨",M:"à¤à¤• à¤®à¤¹à¥€à¤¨à¥‡",MM:"%d à¤®à¤¹à¥€à¤¨à¥‡",y:"à¤à¤• à¤µà¤°à¥à¤·",yy:"%d à¤µà¤°à¥à¤·"},preparse:function(a){return a.replace(/[à¥§à¥¨à¥©à¥ªà¥«à¥¬à¥­à¥®à¥¯à¥¦]/g,function(a){return c[a]})},postformat:function(a){return a.replace(/\d/g,function(a){return b[a]})},meridiem:function(a){return 4>a?"à¤°à¤¾à¤¤":10>a?"à¤¸à¥à¤¬à¤¹":17>a?"à¤¦à¥‹à¤ªà¤¹à¤°":20>a?"à¤¶à¤¾à¤®":"à¤°à¤¾à¤¤"},week:{dow:0,doy:6}})}),function(a){a(bb)}(function(a){function b(a,b,c){var d=a+" ";switch(c){case"m":return b?"jedna minuta":"jedne minute";case"mm":return d+=1===a?"minuta":2===a||3===a||4===a?"minute":"minuta";case"h":return b?"jedan sat":"jednog sata";case"hh":return d+=1===a?"sat":2===a||3===a||4===a?"sata":"sati";case"dd":return d+=1===a?"dan":"dana";case"MM":return d+=1===a?"mjesec":2===a||3===a||4===a?"mjeseca":"mjeseci";case"yy":return d+=1===a?"godina":2===a||3===a||4===a?"godine":"godina"}}return a.lang("hr",{months:"sjeÄanj_veljaÄa_oÅ¾ujak_travanj_svibanj_lipanj_srpanj_kolovoz_rujan_listopad_studeni_prosinac".split("_"),monthsShort:"sje._vel._oÅ¾u._tra._svi._lip._srp._kol._ruj._lis._stu._pro.".split("_"),weekdays:"nedjelja_ponedjeljak_utorak_srijeda_Äetvrtak_petak_subota".split("_"),weekdaysShort:"ned._pon._uto._sri._Äet._pet._sub.".split("_"),weekdaysMin:"ne_po_ut_sr_Äe_pe_su".split("_"),longDateFormat:{LT:"H:mm",L:"DD. MM. YYYY",LL:"D. MMMM YYYY",LLL:"D. MMMM YYYY LT",LLLL:"dddd, D. MMMM YYYY LT"},calendar:{sameDay:"[danas u] LT",nextDay:"[sutra u] LT",nextWeek:function(){switch(this.day()){case 0:return"[u] [nedjelju] [u] LT";case 3:return"[u] [srijedu] [u] LT";case 6:return"[u] [subotu] [u] LT";case 1:case 2:case 4:case 5:return"[u] dddd [u] LT"}},lastDay:"[juÄer u] LT",lastWeek:function(){switch(this.day()){case 0:case 3:return"[proÅ¡lu] dddd [u] LT";case 6:return"[proÅ¡le] [subote] [u] LT";case 1:case 2:case 4:case 5:return"[proÅ¡li] dddd [u] LT"}},sameElse:"L"},relativeTime:{future:"za %s",past:"prije %s",s:"par sekundi",m:b,mm:b,h:b,hh:b,d:"dan",dd:b,M:"mjesec",MM:b,y:"godinu",yy:b},ordinal:"%d.",week:{dow:1,doy:7}})}),function(a){a(bb)}(function(a){function b(a,b,c,d){var e=a;switch(c){case"s":return d||b?"nÃ©hÃ¡ny mÃ¡sodperc":"nÃ©hÃ¡ny mÃ¡sodperce";case"m":return"egy"+(d||b?" perc":" perce");case"mm":return e+(d||b?" perc":" perce");case"h":return"egy"+(d||b?" Ã³ra":" Ã³rÃ¡ja");case"hh":return e+(d||b?" Ã³ra":" Ã³rÃ¡ja");case"d":return"egy"+(d||b?" nap":" napja");case"dd":return e+(d||b?" nap":" napja");case"M":return"egy"+(d||b?" hÃ³nap":" hÃ³napja");case"MM":return e+(d||b?" hÃ³nap":" hÃ³napja");case"y":return"egy"+(d||b?" Ã©v":" Ã©ve");case"yy":return e+(d||b?" Ã©v":" Ã©ve")}return""}function c(a){return(a?"":"[mÃºlt] ")+"["+d[this.day()]+"] LT[-kor]"}var d="vasÃ¡rnap hÃ©tfÅ‘n kedden szerdÃ¡n csÃ¼tÃ¶rtÃ¶kÃ¶n pÃ©nteken szombaton".split(" ");return a.lang("hu",{months:"januÃ¡r_februÃ¡r_mÃ¡rcius_Ã¡prilis_mÃ¡jus_jÃºnius_jÃºlius_augusztus_szeptember_oktÃ³ber_november_december".split("_"),monthsShort:"jan_feb_mÃ¡rc_Ã¡pr_mÃ¡j_jÃºn_jÃºl_aug_szept_okt_nov_dec".split("_"),weekdays:"vasÃ¡rnap_hÃ©tfÅ‘_kedd_szerda_csÃ¼tÃ¶rtÃ¶k_pÃ©ntek_szombat".split("_"),weekdaysShort:"vas_hÃ©t_kedd_sze_csÃ¼t_pÃ©n_szo".split("_"),weekdaysMin:"v_h_k_sze_cs_p_szo".split("_"),longDateFormat:{LT:"H:mm",L:"YYYY.MM.DD.",LL:"YYYY. MMMM D.",LLL:"YYYY. MMMM D., LT",LLLL:"YYYY. MMMM D., dddd LT"},calendar:{sameDay:"[ma] LT[-kor]",nextDay:"[holnap] LT[-kor]",nextWeek:function(){return c.call(this,!0)},lastDay:"[tegnap] LT[-kor]",lastWeek:function(){return c.call(this,!1)},sameElse:"L"},relativeTime:{future:"%s mÃºlva",past:"%s",s:b,m:b,mm:b,h:b,hh:b,d:b,dd:b,M:b,MM:b,y:b,yy:b},ordinal:"%d.",week:{dow:1,doy:7}})}),function(a){a(bb)}(function(a){return a.lang("id",{months:"Januari_Februari_Maret_April_Mei_Juni_Juli_Agustus_September_Oktober_November_Desember".split("_"),monthsShort:"Jan_Feb_Mar_Apr_Mei_Jun_Jul_Ags_Sep_Okt_Nov_Des".split("_"),weekdays:"Minggu_Senin_Selasa_Rabu_Kamis_Jumat_Sabtu".split("_"),weekdaysShort:"Min_Sen_Sel_Rab_Kam_Jum_Sab".split("_"),weekdaysMin:"Mg_Sn_Sl_Rb_Km_Jm_Sb".split("_"),longDateFormat:{LT:"HH.mm",L:"DD/MM/YYYY",LL:"D MMMM YYYY",LLL:"D MMMM YYYY [pukul] LT",LLLL:"dddd, D MMMM YYYY [pukul] LT"},meridiem:function(a){return 11>a?"pagi":15>a?"siang":19>a?"sore":"malam"},calendar:{sameDay:"[Hari ini pukul] LT",nextDay:"[Besok pukul] LT",nextWeek:"dddd [pukul] LT",lastDay:"[Kemarin pukul] LT",lastWeek:"dddd [lalu pukul] LT",sameElse:"L"},relativeTime:{future:"dalam %s",past:"%s yang lalu",s:"beberapa detik",m:"semenit",mm:"%d menit",h:"sejam",hh:"%d jam",d:"sehari",dd:"%d hari",M:"sebulan",MM:"%d bulan",y:"setahun",yy:"%d tahun"},week:{dow:1,doy:7}})}),function(a){a(bb)}(function(a){function b(a){return 11===a%100?!0:1===a%10?!1:!0}function c(a,c,d,e){var f=a+" ";switch(d){case"s":return c||e?"nokkrar sekÃºndur":"nokkrum sekÃºndum";case"m":return c?"mÃ­nÃºta":"mÃ­nÃºtu";case"mm":return b(a)?f+(c||e?"mÃ­nÃºtur":"mÃ­nÃºtum"):c?f+"mÃ­nÃºta":f+"mÃ­nÃºtu";case"hh":return b(a)?f+(c||e?"klukkustundir":"klukkustundum"):f+"klukkustund";case"d":return c?"dagur":e?"dag":"degi";case"dd":return b(a)?c?f+"dagar":f+(e?"daga":"dÃ¶gum"):c?f+"dagur":f+(e?"dag":"degi");case"M":return c?"mÃ¡nuÃ°ur":e?"mÃ¡nuÃ°":"mÃ¡nuÃ°i";case"MM":return b(a)?c?f+"mÃ¡nuÃ°ir":f+(e?"mÃ¡nuÃ°i":"mÃ¡nuÃ°um"):c?f+"mÃ¡nuÃ°ur":f+(e?"mÃ¡nuÃ°":"mÃ¡nuÃ°i");case"y":return c||e?"Ã¡r":"Ã¡ri";case"yy":return b(a)?f+(c||e?"Ã¡r":"Ã¡rum"):f+(c||e?"Ã¡r":"Ã¡ri")}}return a.lang("is",{months:"janÃºar_febrÃºar_mars_aprÃ­l_maÃ­_jÃºnÃ­_jÃºlÃ­_Ã¡gÃºst_september_oktÃ³ber_nÃ³vember_desember".split("_"),monthsShort:"jan_feb_mar_apr_maÃ­_jÃºn_jÃºl_Ã¡gÃº_sep_okt_nÃ³v_des".split("_"),weekdays:"sunnudagur_mÃ¡nudagur_Ã¾riÃ°judagur_miÃ°vikudagur_fimmtudagur_fÃ¶studagur_laugardagur".split("_"),weekdaysShort:"sun_mÃ¡n_Ã¾ri_miÃ°_fim_fÃ¶s_lau".split("_"),weekdaysMin:"Su_MÃ¡_Ãžr_Mi_Fi_FÃ¶_La".split("_"),longDateFormat:{LT:"H:mm",L:"DD/MM/YYYY",LL:"D. MMMM YYYY",LLL:"D. MMMM YYYY [kl.] LT",LLLL:"dddd, D. MMMM YYYY [kl.] LT"},calendar:{sameDay:"[Ã­ dag kl.] LT",nextDay:"[Ã¡ morgun kl.] LT",nextWeek:"dddd [kl.] LT",lastDay:"[Ã­ gÃ¦r kl.] LT",lastWeek:"[sÃ­Ã°asta] dddd [kl.] LT",sameElse:"L"},relativeTime:{future:"eftir %s",past:"fyrir %s sÃ­Ã°an",s:c,m:c,mm:c,h:"klukkustund",hh:c,d:c,dd:c,M:c,MM:c,y:c,yy:c},ordinal:"%d.",week:{dow:1,doy:4}})}),function(a){a(bb)}(function(a){return a.lang("it",{months:"Gennaio_Febbraio_Marzo_Aprile_Maggio_Giugno_Luglio_Agosto_Settembre_Ottobre_Novembre_Dicembre".split("_"),monthsShort:"Gen_Feb_Mar_Apr_Mag_Giu_Lug_Ago_Set_Ott_Nov_Dic".split("_"),weekdays:"Domenica_LunedÃ¬_MartedÃ¬_MercoledÃ¬_GiovedÃ¬_VenerdÃ¬_Sabato".split("_"),weekdaysShort:"Dom_Lun_Mar_Mer_Gio_Ven_Sab".split("_"),weekdaysMin:"D_L_Ma_Me_G_V_S".split("_"),longDateFormat:{LT:"HH:mm",L:"DD/MM/YYYY",LL:"D MMMM YYYY",LLL:"D MMMM YYYY LT",LLLL:"dddd, D MMMM YYYY LT"},calendar:{sameDay:"[Oggi alle] LT",nextDay:"[Domani alle] LT",nextWeek:"dddd [alle] LT",lastDay:"[Ieri alle] LT",lastWeek:"[lo scorso] dddd [alle] LT",sameElse:"L"},relativeTime:{future:function(a){return(/^[0-9].+$/.test(a)?"tra":"in")+" "+a},past:"%s fa",s:"secondi",m:"un minuto",mm:"%d minuti",h:"un'ora",hh:"%d ore",d:"un giorno",dd:"%d giorni",M:"un mese",MM:"%d mesi",y:"un anno",yy:"%d anni"},ordinal:"%d",week:{dow:1,doy:4}})}),function(a){a(bb)}(function(a){return a.lang("ja",{months:"1æœˆ_2æœˆ_3æœˆ_4æœˆ_5æœˆ_6æœˆ_7æœˆ_8æœˆ_9æœˆ_10æœˆ_11æœˆ_12æœˆ".split("_"),monthsShort:"1æœˆ_2æœˆ_3æœˆ_4æœˆ_5æœˆ_6æœˆ_7æœˆ_8æœˆ_9æœˆ_10æœˆ_11æœˆ_12æœˆ".split("_"),weekdays:"æ—¥æ›œæ—¥_æœˆæ›œæ—¥_ç«æ›œæ—¥_æ°´æ›œæ—¥_æœ¨æ›œæ—¥_é‡‘æ›œæ—¥_åœŸæ›œæ—¥".split("_"),weekdaysShort:"æ—¥_æœˆ_ç«_æ°´_æœ¨_é‡‘_åœŸ".split("_"),weekdaysMin:"æ—¥_æœˆ_ç«_æ°´_æœ¨_é‡‘_åœŸ".split("_"),longDateFormat:{LT:"Ahæ™‚måˆ†",L:"YYYY/MM/DD",LL:"YYYYå¹´MæœˆDæ—¥",LLL:"YYYYå¹´MæœˆDæ—¥LT",LLLL:"YYYYå¹´MæœˆDæ—¥LT dddd"},meridiem:function(a){return 12>a?"åˆå‰":"åˆå¾Œ"},calendar:{sameDay:"[ä»Šæ—¥] LT",nextDay:"[æ˜Žæ—¥] LT",nextWeek:"[æ¥é€±]dddd LT",lastDay:"[æ˜¨æ—¥] LT",lastWeek:"[å‰é€±]dddd LT",sameElse:"L"},relativeTime:{future:"%så¾Œ",past:"%så‰",s:"æ•°ç§’",m:"1åˆ†",mm:"%dåˆ†",h:"1æ™‚é–“",hh:"%dæ™‚é–“",d:"1æ—¥",dd:"%dæ—¥",M:"1ãƒ¶æœˆ",MM:"%dãƒ¶æœˆ",y:"1å¹´",yy:"%då¹´"}})}),function(a){a(bb)}(function(a){function b(a,b){var c={nominative:"áƒ˜áƒáƒœáƒ•áƒáƒ áƒ˜_áƒ—áƒ”áƒ‘áƒ”áƒ áƒ•áƒáƒšáƒ˜_áƒ›áƒáƒ áƒ¢áƒ˜_áƒáƒžáƒ áƒ˜áƒšáƒ˜_áƒ›áƒáƒ˜áƒ¡áƒ˜_áƒ˜áƒ•áƒœáƒ˜áƒ¡áƒ˜_áƒ˜áƒ•áƒšáƒ˜áƒ¡áƒ˜_áƒáƒ’áƒ•áƒ˜áƒ¡áƒ¢áƒ_áƒ¡áƒ”áƒ¥áƒ¢áƒ”áƒ›áƒ‘áƒ”áƒ áƒ˜_áƒáƒ¥áƒ¢áƒáƒ›áƒ‘áƒ”áƒ áƒ˜_áƒœáƒáƒ”áƒ›áƒ‘áƒ”áƒ áƒ˜_áƒ“áƒ”áƒ™áƒ”áƒ›áƒ‘áƒ”áƒ áƒ˜".split("_"),accusative:"áƒ˜áƒáƒœáƒ•áƒáƒ áƒ¡_áƒ—áƒ”áƒ‘áƒ”áƒ áƒ•áƒáƒšáƒ¡_áƒ›áƒáƒ áƒ¢áƒ¡_áƒáƒžáƒ áƒ˜áƒšáƒ˜áƒ¡_áƒ›áƒáƒ˜áƒ¡áƒ¡_áƒ˜áƒ•áƒœáƒ˜áƒ¡áƒ¡_áƒ˜áƒ•áƒšáƒ˜áƒ¡áƒ¡_áƒáƒ’áƒ•áƒ˜áƒ¡áƒ¢áƒ¡_áƒ¡áƒ”áƒ¥áƒ¢áƒ”áƒ›áƒ‘áƒ”áƒ áƒ¡_áƒáƒ¥áƒ¢áƒáƒ›áƒ‘áƒ”áƒ áƒ¡_áƒœáƒáƒ”áƒ›áƒ‘áƒ”áƒ áƒ¡_áƒ“áƒ”áƒ™áƒ”áƒ›áƒ‘áƒ”áƒ áƒ¡".split("_")},d=/D[oD] *MMMM?/.test(b)?"accusative":"nominative";return c[d][a.month()]}function c(a,b){var c={nominative:"áƒ™áƒ•áƒ˜áƒ áƒ_áƒáƒ áƒ¨áƒáƒ‘áƒáƒ—áƒ˜_áƒ¡áƒáƒ›áƒ¨áƒáƒ‘áƒáƒ—áƒ˜_áƒáƒ—áƒ®áƒ¨áƒáƒ‘áƒáƒ—áƒ˜_áƒ®áƒ£áƒ—áƒ¨áƒáƒ‘áƒáƒ—áƒ˜_áƒžáƒáƒ áƒáƒ¡áƒ™áƒ”áƒ•áƒ˜_áƒ¨áƒáƒ‘áƒáƒ—áƒ˜".split("_"),accusative:"áƒ™áƒ•áƒ˜áƒ áƒáƒ¡_áƒáƒ áƒ¨áƒáƒ‘áƒáƒ—áƒ¡_áƒ¡áƒáƒ›áƒ¨áƒáƒ‘áƒáƒ—áƒ¡_áƒáƒ—áƒ®áƒ¨áƒáƒ‘áƒáƒ—áƒ¡_áƒ®áƒ£áƒ—áƒ¨áƒáƒ‘áƒáƒ—áƒ¡_áƒžáƒáƒ áƒáƒ¡áƒ™áƒ”áƒ•áƒ¡_áƒ¨áƒáƒ‘áƒáƒ—áƒ¡".split("_")},d=/(áƒ¬áƒ˜áƒœáƒ|áƒ¨áƒ”áƒ›áƒ“áƒ”áƒ’)/.test(b)?"accusative":"nominative";return c[d][a.day()]}return a.lang("ka",{months:b,monthsShort:"áƒ˜áƒáƒœ_áƒ—áƒ”áƒ‘_áƒ›áƒáƒ _áƒáƒžáƒ _áƒ›áƒáƒ˜_áƒ˜áƒ•áƒœ_áƒ˜áƒ•áƒš_áƒáƒ’áƒ•_áƒ¡áƒ”áƒ¥_áƒáƒ¥áƒ¢_áƒœáƒáƒ”_áƒ“áƒ”áƒ™".split("_"),weekdays:c,weekdaysShort:"áƒ™áƒ•áƒ˜_áƒáƒ áƒ¨_áƒ¡áƒáƒ›_áƒáƒ—áƒ®_áƒ®áƒ£áƒ—_áƒžáƒáƒ _áƒ¨áƒáƒ‘".split("_"),weekdaysMin:"áƒ™áƒ•_áƒáƒ _áƒ¡áƒ_áƒáƒ—_áƒ®áƒ£_áƒžáƒ_áƒ¨áƒ".split("_"),longDateFormat:{LT:"h:mm A",L:"DD/MM/YYYY",LL:"D MMMM YYYY",LLL:"D MMMM YYYY LT",LLLL:"dddd, D MMMM YYYY LT"},calendar:{sameDay:"[áƒ“áƒ¦áƒ”áƒ¡] LT[-áƒ–áƒ”]",nextDay:"[áƒ®áƒ•áƒáƒš] LT[-áƒ–áƒ”]",lastDay:"[áƒ’áƒ£áƒ¨áƒ˜áƒœ] LT[-áƒ–áƒ”]",nextWeek:"[áƒ¨áƒ”áƒ›áƒ“áƒ”áƒ’] dddd LT[-áƒ–áƒ”]",lastWeek:"[áƒ¬áƒ˜áƒœáƒ] dddd LT-áƒ–áƒ”",sameElse:"L"},relativeTime:{future:function(a){return/(áƒ¬áƒáƒ›áƒ˜|áƒ¬áƒ£áƒ—áƒ˜|áƒ¡áƒáƒáƒ—áƒ˜|áƒ¬áƒ”áƒšáƒ˜)/.test(a)?a.replace(/áƒ˜$/,"áƒ¨áƒ˜"):a+"áƒ¨áƒ˜"
},past:function(a){return/(áƒ¬áƒáƒ›áƒ˜|áƒ¬áƒ£áƒ—áƒ˜|áƒ¡áƒáƒáƒ—áƒ˜|áƒ“áƒ¦áƒ”|áƒ—áƒ•áƒ”)/.test(a)?a.replace(/(áƒ˜|áƒ”)$/,"áƒ˜áƒ¡ áƒ¬áƒ˜áƒœ"):/áƒ¬áƒ”áƒšáƒ˜/.test(a)?a.replace(/áƒ¬áƒ”áƒšáƒ˜$/,"áƒ¬áƒšáƒ˜áƒ¡ áƒ¬áƒ˜áƒœ"):void 0},s:"áƒ áƒáƒ›áƒ“áƒ”áƒœáƒ˜áƒ›áƒ” áƒ¬áƒáƒ›áƒ˜",m:"áƒ¬áƒ£áƒ—áƒ˜",mm:"%d áƒ¬áƒ£áƒ—áƒ˜",h:"áƒ¡áƒáƒáƒ—áƒ˜",hh:"%d áƒ¡áƒáƒáƒ—áƒ˜",d:"áƒ“áƒ¦áƒ”",dd:"%d áƒ“áƒ¦áƒ”",M:"áƒ—áƒ•áƒ”",MM:"%d áƒ—áƒ•áƒ”",y:"áƒ¬áƒ”áƒšáƒ˜",yy:"%d áƒ¬áƒ”áƒšáƒ˜"},ordinal:function(a){return 0===a?a:1===a?a+"-áƒšáƒ˜":20>a||100>=a&&0===a%20||0===a%100?"áƒ›áƒ”-"+a:a+"-áƒ”"},week:{dow:1,doy:7}})}),function(a){a(bb)}(function(a){return a.lang("ko",{months:"1ì›”_2ì›”_3ì›”_4ì›”_5ì›”_6ì›”_7ì›”_8ì›”_9ì›”_10ì›”_11ì›”_12ì›”".split("_"),monthsShort:"1ì›”_2ì›”_3ì›”_4ì›”_5ì›”_6ì›”_7ì›”_8ì›”_9ì›”_10ì›”_11ì›”_12ì›”".split("_"),weekdays:"ì¼ìš”ì¼_ì›”ìš”ì¼_í™”ìš”ì¼_ìˆ˜ìš”ì¼_ëª©ìš”ì¼_ê¸ˆìš”ì¼_í† ìš”ì¼".split("_"),weekdaysShort:"ì¼_ì›”_í™”_ìˆ˜_ëª©_ê¸ˆ_í† ".split("_"),weekdaysMin:"ì¼_ì›”_í™”_ìˆ˜_ëª©_ê¸ˆ_í† ".split("_"),longDateFormat:{LT:"A hì‹œ mmë¶„",L:"YYYY.MM.DD",LL:"YYYYë…„ MMMM Dì¼",LLL:"YYYYë…„ MMMM Dì¼ LT",LLLL:"YYYYë…„ MMMM Dì¼ dddd LT"},meridiem:function(a){return 12>a?"ì˜¤ì „":"ì˜¤í›„"},calendar:{sameDay:"ì˜¤ëŠ˜ LT",nextDay:"ë‚´ì¼ LT",nextWeek:"dddd LT",lastDay:"ì–´ì œ LT",lastWeek:"ì§€ë‚œì£¼ dddd LT",sameElse:"L"},relativeTime:{future:"%s í›„",past:"%s ì „",s:"ëª‡ì´ˆ",ss:"%dì´ˆ",m:"ì¼ë¶„",mm:"%dë¶„",h:"í•œì‹œê°„",hh:"%dì‹œê°„",d:"í•˜ë£¨",dd:"%dì¼",M:"í•œë‹¬",MM:"%dë‹¬",y:"ì¼ë…„",yy:"%dë…„"},ordinal:"%dì¼"})}),function(a){a(bb)}(function(a){function b(a,b,c,d){return b?"kelios sekundÄ—s":d?"keliÅ³ sekundÅ¾iÅ³":"kelias sekundes"}function c(a,b,c,d){return b?e(c)[0]:d?e(c)[1]:e(c)[2]}function d(a){return 0===a%10||a>10&&20>a}function e(a){return h[a].split("_")}function f(a,b,f,g){var h=a+" ";return 1===a?h+c(a,b,f[0],g):b?h+(d(a)?e(f)[1]:e(f)[0]):g?h+e(f)[1]:h+(d(a)?e(f)[1]:e(f)[2])}function g(a,b){var c=-1===b.indexOf("dddd LT"),d=i[a.weekday()];return c?d:d.substring(0,d.length-2)+"Ä¯"}var h={m:"minutÄ—_minutÄ—s_minutÄ™",mm:"minutÄ—s_minuÄiÅ³_minutes",h:"valanda_valandos_valandÄ…",hh:"valandos_valandÅ³_valandas",d:"diena_dienos_dienÄ…",dd:"dienos_dienÅ³_dienas",M:"mÄ—nuo_mÄ—nesio_mÄ—nesÄ¯",MM:"mÄ—nesiai_mÄ—nesiÅ³_mÄ—nesius",y:"metai_metÅ³_metus",yy:"metai_metÅ³_metus"},i="pirmadienis_antradienis_treÄiadienis_ketvirtadienis_penktadienis_Å¡eÅ¡tadienis_sekmadienis".split("_");return a.lang("lt",{months:"sausio_vasario_kovo_balandÅ¾io_geguÅ¾Ä—s_birÅ¾Ä—lio_liepos_rugpjÅ«Äio_rugsÄ—jo_spalio_lapkriÄio_gruodÅ¾io".split("_"),monthsShort:"sau_vas_kov_bal_geg_bir_lie_rgp_rgs_spa_lap_grd".split("_"),weekdays:g,weekdaysShort:"Sek_Pir_Ant_Tre_Ket_Pen_Å eÅ¡".split("_"),weekdaysMin:"S_P_A_T_K_Pn_Å ".split("_"),longDateFormat:{LT:"HH:mm",L:"YYYY-MM-DD",LL:"YYYY [m.] MMMM D [d.]",LLL:"YYYY [m.] MMMM D [d.], LT [val.]",LLLL:"YYYY [m.] MMMM D [d.], dddd, LT [val.]",l:"YYYY-MM-DD",ll:"YYYY [m.] MMMM D [d.]",lll:"YYYY [m.] MMMM D [d.], LT [val.]",llll:"YYYY [m.] MMMM D [d.], ddd, LT [val.]"},calendar:{sameDay:"[Å iandien] LT",nextDay:"[Rytoj] LT",nextWeek:"dddd LT",lastDay:"[Vakar] LT",lastWeek:"[PraÄ—jusÄ¯] dddd LT",sameElse:"L"},relativeTime:{future:"po %s",past:"prieÅ¡ %s",s:b,m:c,mm:f,h:c,hh:f,d:c,dd:f,M:c,MM:f,y:c,yy:f},ordinal:function(a){return a+"-oji"},week:{dow:1,doy:4}})}),function(a){a(bb)}(function(a){function b(a,b,c){var d=a.split("_");return c?1===b%10&&11!==b?d[2]:d[3]:1===b%10&&11!==b?d[0]:d[1]}function c(a,c,e){return a+" "+b(d[e],a,c)}var d={mm:"minÅ«ti_minÅ«tes_minÅ«te_minÅ«tes",hh:"stundu_stundas_stunda_stundas",dd:"dienu_dienas_diena_dienas",MM:"mÄ“nesi_mÄ“neÅ¡us_mÄ“nesis_mÄ“neÅ¡i",yy:"gadu_gadus_gads_gadi"};return a.lang("lv",{months:"janvÄris_februÄris_marts_aprÄ«lis_maijs_jÅ«nijs_jÅ«lijs_augusts_septembris_oktobris_novembris_decembris".split("_"),monthsShort:"jan_feb_mar_apr_mai_jÅ«n_jÅ«l_aug_sep_okt_nov_dec".split("_"),weekdays:"svÄ“tdiena_pirmdiena_otrdiena_treÅ¡diena_ceturtdiena_piektdiena_sestdiena".split("_"),weekdaysShort:"Sv_P_O_T_C_Pk_S".split("_"),weekdaysMin:"Sv_P_O_T_C_Pk_S".split("_"),longDateFormat:{LT:"HH:mm",L:"DD.MM.YYYY",LL:"YYYY. [gada] D. MMMM",LLL:"YYYY. [gada] D. MMMM, LT",LLLL:"YYYY. [gada] D. MMMM, dddd, LT"},calendar:{sameDay:"[Å odien pulksten] LT",nextDay:"[RÄ«t pulksten] LT",nextWeek:"dddd [pulksten] LT",lastDay:"[Vakar pulksten] LT",lastWeek:"[PagÄjuÅ¡Ä] dddd [pulksten] LT",sameElse:"L"},relativeTime:{future:"%s vÄ“lÄk",past:"%s agrÄk",s:"daÅ¾as sekundes",m:"minÅ«ti",mm:c,h:"stundu",hh:c,d:"dienu",dd:c,M:"mÄ“nesi",MM:c,y:"gadu",yy:c},ordinal:"%d.",week:{dow:1,doy:4}})}),function(a){a(bb)}(function(a){return a.lang("ml",{months:"à´œà´¨àµà´µà´°à´¿_à´«àµ†à´¬àµà´°àµà´µà´°à´¿_à´®à´¾àµ¼à´šàµà´šàµ_à´à´ªàµà´°à´¿àµ½_à´®àµ‡à´¯àµ_à´œàµ‚àµº_à´œàµ‚à´²àµˆ_à´“à´—à´¸àµà´±àµà´±àµ_à´¸àµ†à´ªàµà´±àµà´±à´‚à´¬àµ¼_à´’à´•àµà´Ÿàµ‹à´¬àµ¼_à´¨à´µà´‚à´¬àµ¼_à´¡à´¿à´¸à´‚à´¬àµ¼".split("_"),monthsShort:"à´œà´¨àµ._à´«àµ†à´¬àµà´°àµ._à´®à´¾àµ¼._à´à´ªàµà´°à´¿._à´®àµ‡à´¯àµ_à´œàµ‚àµº_à´œàµ‚à´²àµˆ._à´“à´—._à´¸àµ†à´ªàµà´±àµà´±._à´’à´•àµà´Ÿàµ‹._à´¨à´µà´‚._à´¡à´¿à´¸à´‚.".split("_"),weekdays:"à´žà´¾à´¯à´±à´¾à´´àµà´š_à´¤à´¿à´™àµà´•à´³à´¾à´´àµà´š_à´šàµŠà´µàµà´µà´¾à´´àµà´š_à´¬àµà´§à´¨à´¾à´´àµà´š_à´µàµà´¯à´¾à´´à´¾à´´àµà´š_à´µàµ†à´³àµà´³à´¿à´¯à´¾à´´àµà´š_à´¶à´¨à´¿à´¯à´¾à´´àµà´š".split("_"),weekdaysShort:"à´žà´¾à´¯àµ¼_à´¤à´¿à´™àµà´•àµ¾_à´šàµŠà´µàµà´µ_à´¬àµà´§àµ»_à´µàµà´¯à´¾à´´à´‚_à´µàµ†à´³àµà´³à´¿_à´¶à´¨à´¿".split("_"),weekdaysMin:"à´žà´¾_à´¤à´¿_à´šàµŠ_à´¬àµ_à´µàµà´¯à´¾_à´µàµ†_à´¶".split("_"),longDateFormat:{LT:"A h:mm -à´¨àµ",L:"DD/MM/YYYY",LL:"D MMMM YYYY",LLL:"D MMMM YYYY, LT",LLLL:"dddd, D MMMM YYYY, LT"},calendar:{sameDay:"[à´‡à´¨àµà´¨àµ] LT",nextDay:"[à´¨à´¾à´³àµ†] LT",nextWeek:"dddd, LT",lastDay:"[à´‡à´¨àµà´¨à´²àµ†] LT",lastWeek:"[à´•à´´à´¿à´žàµà´ž] dddd, LT",sameElse:"L"},relativeTime:{future:"%s à´•à´´à´¿à´žàµà´žàµ",past:"%s à´®àµàµ»à´ªàµ",s:"à´…àµ½à´ª à´¨à´¿à´®à´¿à´·à´™àµà´™àµ¾",m:"à´’à´°àµ à´®à´¿à´¨à´¿à´±àµà´±àµ",mm:"%d à´®à´¿à´¨à´¿à´±àµà´±àµ",h:"à´’à´°àµ à´®à´£à´¿à´•àµà´•àµ‚àµ¼",hh:"%d à´®à´£à´¿à´•àµà´•àµ‚àµ¼",d:"à´’à´°àµ à´¦à´¿à´µà´¸à´‚",dd:"%d à´¦à´¿à´µà´¸à´‚",M:"à´’à´°àµ à´®à´¾à´¸à´‚",MM:"%d à´®à´¾à´¸à´‚",y:"à´’à´°àµ à´µàµ¼à´·à´‚",yy:"%d à´µàµ¼à´·à´‚"},meridiem:function(a){return 4>a?"à´°à´¾à´¤àµà´°à´¿":12>a?"à´°à´¾à´µà´¿à´²àµ†":17>a?"à´‰à´šàµà´š à´•à´´à´¿à´žàµà´žàµ":20>a?"à´µàµˆà´•àµà´¨àµà´¨àµ‡à´°à´‚":"à´°à´¾à´¤àµà´°à´¿"}})}),function(a){a(bb)}(function(a){var b={1:"à¥§",2:"à¥¨",3:"à¥©",4:"à¥ª",5:"à¥«",6:"à¥¬",7:"à¥­",8:"à¥®",9:"à¥¯",0:"à¥¦"},c={"à¥§":"1","à¥¨":"2","à¥©":"3","à¥ª":"4","à¥«":"5","à¥¬":"6","à¥­":"7","à¥®":"8","à¥¯":"9","à¥¦":"0"};return a.lang("mr",{months:"à¤œà¤¾à¤¨à¥‡à¤µà¤¾à¤°à¥€_à¤«à¥‡à¤¬à¥à¤°à¥à¤µà¤¾à¤°à¥€_à¤®à¤¾à¤°à¥à¤š_à¤à¤ªà¥à¤°à¤¿à¤²_à¤®à¥‡_à¤œà¥‚à¤¨_à¤œà¥à¤²à¥ˆ_à¤‘à¤—à¤¸à¥à¤Ÿ_à¤¸à¤ªà¥à¤Ÿà¥‡à¤‚à¤¬à¤°_à¤‘à¤•à¥à¤Ÿà¥‹à¤¬à¤°_à¤¨à¥‹à¤µà¥à¤¹à¥‡à¤‚à¤¬à¤°_à¤¡à¤¿à¤¸à¥‡à¤‚à¤¬à¤°".split("_"),monthsShort:"à¤œà¤¾à¤¨à¥‡._à¤«à¥‡à¤¬à¥à¤°à¥._à¤®à¤¾à¤°à¥à¤š._à¤à¤ªà¥à¤°à¤¿._à¤®à¥‡._à¤œà¥‚à¤¨._à¤œà¥à¤²à¥ˆ._à¤‘à¤—._à¤¸à¤ªà¥à¤Ÿà¥‡à¤‚._à¤‘à¤•à¥à¤Ÿà¥‹._à¤¨à¥‹à¤µà¥à¤¹à¥‡à¤‚._à¤¡à¤¿à¤¸à¥‡à¤‚.".split("_"),weekdays:"à¤°à¤µà¤¿à¤µà¤¾à¤°_à¤¸à¥‹à¤®à¤µà¤¾à¤°_à¤®à¤‚à¤—à¤³à¤µà¤¾à¤°_à¤¬à¥à¤§à¤µà¤¾à¤°_à¤—à¥à¤°à¥‚à¤µà¤¾à¤°_à¤¶à¥à¤•à¥à¤°à¤µà¤¾à¤°_à¤¶à¤¨à¤¿à¤µà¤¾à¤°".split("_"),weekdaysShort:"à¤°à¤µà¤¿_à¤¸à¥‹à¤®_à¤®à¤‚à¤—à¤³_à¤¬à¥à¤§_à¤—à¥à¤°à¥‚_à¤¶à¥à¤•à¥à¤°_à¤¶à¤¨à¤¿".split("_"),weekdaysMin:"à¤°_à¤¸à¥‹_à¤®à¤‚_à¤¬à¥_à¤—à¥_à¤¶à¥_à¤¶".split("_"),longDateFormat:{LT:"A h:mm à¤µà¤¾à¤œà¤¤à¤¾",L:"DD/MM/YYYY",LL:"D MMMM YYYY",LLL:"D MMMM YYYY, LT",LLLL:"dddd, D MMMM YYYY, LT"},calendar:{sameDay:"[à¤†à¤œ] LT",nextDay:"[à¤‰à¤¦à¥à¤¯à¤¾] LT",nextWeek:"dddd, LT",lastDay:"[à¤•à¤¾à¤²] LT",lastWeek:"[à¤®à¤¾à¤—à¥€à¤²] dddd, LT",sameElse:"L"},relativeTime:{future:"%s à¤¨à¤‚à¤¤à¤°",past:"%s à¤ªà¥‚à¤°à¥à¤µà¥€",s:"à¤¸à¥‡à¤•à¤‚à¤¦",m:"à¤à¤• à¤®à¤¿à¤¨à¤¿à¤Ÿ",mm:"%d à¤®à¤¿à¤¨à¤¿à¤Ÿà¥‡",h:"à¤à¤• à¤¤à¤¾à¤¸",hh:"%d à¤¤à¤¾à¤¸",d:"à¤à¤• à¤¦à¤¿à¤µà¤¸",dd:"%d à¤¦à¤¿à¤µà¤¸",M:"à¤à¤• à¤®à¤¹à¤¿à¤¨à¤¾",MM:"%d à¤®à¤¹à¤¿à¤¨à¥‡",y:"à¤à¤• à¤µà¤°à¥à¤·",yy:"%d à¤µà¤°à¥à¤·à¥‡"},preparse:function(a){return a.replace(/[à¥§à¥¨à¥©à¥ªà¥«à¥¬à¥­à¥®à¥¯à¥¦]/g,function(a){return c[a]})},postformat:function(a){return a.replace(/\d/g,function(a){return b[a]})},meridiem:function(a){return 4>a?"à¤°à¤¾à¤¤à¥à¤°à¥€":10>a?"à¤¸à¤•à¤¾à¤³à¥€":17>a?"à¤¦à¥à¤ªà¤¾à¤°à¥€":20>a?"à¤¸à¤¾à¤¯à¤‚à¤•à¤¾à¤³à¥€":"à¤°à¤¾à¤¤à¥à¤°à¥€"},week:{dow:0,doy:6}})}),function(a){a(bb)}(function(a){return a.lang("ms-my",{months:"Januari_Februari_Mac_April_Mei_Jun_Julai_Ogos_September_Oktober_November_Disember".split("_"),monthsShort:"Jan_Feb_Mac_Apr_Mei_Jun_Jul_Ogs_Sep_Okt_Nov_Dis".split("_"),weekdays:"Ahad_Isnin_Selasa_Rabu_Khamis_Jumaat_Sabtu".split("_"),weekdaysShort:"Ahd_Isn_Sel_Rab_Kha_Jum_Sab".split("_"),weekdaysMin:"Ah_Is_Sl_Rb_Km_Jm_Sb".split("_"),longDateFormat:{LT:"HH.mm",L:"DD/MM/YYYY",LL:"D MMMM YYYY",LLL:"D MMMM YYYY [pukul] LT",LLLL:"dddd, D MMMM YYYY [pukul] LT"},meridiem:function(a){return 11>a?"pagi":15>a?"tengahari":19>a?"petang":"malam"},calendar:{sameDay:"[Hari ini pukul] LT",nextDay:"[Esok pukul] LT",nextWeek:"dddd [pukul] LT",lastDay:"[Kelmarin pukul] LT",lastWeek:"dddd [lepas pukul] LT",sameElse:"L"},relativeTime:{future:"dalam %s",past:"%s yang lepas",s:"beberapa saat",m:"seminit",mm:"%d minit",h:"sejam",hh:"%d jam",d:"sehari",dd:"%d hari",M:"sebulan",MM:"%d bulan",y:"setahun",yy:"%d tahun"},week:{dow:1,doy:7}})}),function(a){a(bb)}(function(a){return a.lang("nb",{months:"januar_februar_mars_april_mai_juni_juli_august_september_oktober_november_desember".split("_"),monthsShort:"jan._feb._mars_april_mai_juni_juli_aug._sep._okt._nov._des.".split("_"),weekdays:"sÃ¸ndag_mandag_tirsdag_onsdag_torsdag_fredag_lÃ¸rdag".split("_"),weekdaysShort:"sÃ¸._ma._ti._on._to._fr._lÃ¸.".split("_"),weekdaysMin:"sÃ¸_ma_ti_on_to_fr_lÃ¸".split("_"),longDateFormat:{LT:"H.mm",L:"DD.MM.YYYY",LL:"D. MMMM YYYY",LLL:"D. MMMM YYYY [kl.] LT",LLLL:"dddd D. MMMM YYYY [kl.] LT"},calendar:{sameDay:"[i dag kl.] LT",nextDay:"[i morgen kl.] LT",nextWeek:"dddd [kl.] LT",lastDay:"[i gÃ¥r kl.] LT",lastWeek:"[forrige] dddd [kl.] LT",sameElse:"L"},relativeTime:{future:"om %s",past:"for %s siden",s:"noen sekunder",m:"ett minutt",mm:"%d minutter",h:"en time",hh:"%d timer",d:"en dag",dd:"%d dager",M:"en mÃ¥ned",MM:"%d mÃ¥neder",y:"ett Ã¥r",yy:"%d Ã¥r"},ordinal:"%d.",week:{dow:1,doy:4}})}),function(a){a(bb)}(function(a){var b={1:"à¥§",2:"à¥¨",3:"à¥©",4:"à¥ª",5:"à¥«",6:"à¥¬",7:"à¥­",8:"à¥®",9:"à¥¯",0:"à¥¦"},c={"à¥§":"1","à¥¨":"2","à¥©":"3","à¥ª":"4","à¥«":"5","à¥¬":"6","à¥­":"7","à¥®":"8","à¥¯":"9","à¥¦":"0"};return a.lang("ne",{months:"à¤œà¤¨à¤µà¤°à¥€_à¤«à¥‡à¤¬à¥à¤°à¥à¤µà¤°à¥€_à¤®à¤¾à¤°à¥à¤š_à¤…à¤ªà¥à¤°à¤¿à¤²_à¤®à¤ˆ_à¤œà¥à¤¨_à¤œà¥à¤²à¤¾à¤ˆ_à¤…à¤—à¤·à¥à¤Ÿ_à¤¸à¥‡à¤ªà¥à¤Ÿà¥‡à¤®à¥à¤¬à¤°_à¤…à¤•à¥à¤Ÿà¥‹à¤¬à¤°_à¤¨à¥‹à¤­à¥‡à¤®à¥à¤¬à¤°_à¤¡à¤¿à¤¸à¥‡à¤®à¥à¤¬à¤°".split("_"),monthsShort:"à¤œà¤¨._à¤«à¥‡à¤¬à¥à¤°à¥._à¤®à¤¾à¤°à¥à¤š_à¤…à¤ªà¥à¤°à¤¿._à¤®à¤ˆ_à¤œà¥à¤¨_à¤œà¥à¤²à¤¾à¤ˆ._à¤…à¤—._à¤¸à¥‡à¤ªà¥à¤Ÿ._à¤…à¤•à¥à¤Ÿà¥‹._à¤¨à¥‹à¤­à¥‡._à¤¡à¤¿à¤¸à¥‡.".split("_"),weekdays:"à¤†à¤‡à¤¤à¤¬à¤¾à¤°_à¤¸à¥‹à¤®à¤¬à¤¾à¤°_à¤®à¤™à¥à¤—à¤²à¤¬à¤¾à¤°_à¤¬à¥à¤§à¤¬à¤¾à¤°_à¤¬à¤¿à¤¹à¤¿à¤¬à¤¾à¤°_à¤¶à¥à¤•à¥à¤°à¤¬à¤¾à¤°_à¤¶à¤¨à¤¿à¤¬à¤¾à¤°".split("_"),weekdaysShort:"à¤†à¤‡à¤¤._à¤¸à¥‹à¤®._à¤®à¤™à¥à¤—à¤²._à¤¬à¥à¤§._à¤¬à¤¿à¤¹à¤¿._à¤¶à¥à¤•à¥à¤°._à¤¶à¤¨à¤¿.".split("_"),weekdaysMin:"à¤†à¤‡._à¤¸à¥‹._à¤®à¤™à¥_à¤¬à¥._à¤¬à¤¿._à¤¶à¥._à¤¶.".split("_"),longDateFormat:{LT:"Aà¤•à¥‹ h:mm à¤¬à¤œà¥‡",L:"DD/MM/YYYY",LL:"D MMMM YYYY",LLL:"D MMMM YYYY, LT",LLLL:"dddd, D MMMM YYYY, LT"},preparse:function(a){return a.replace(/[à¥§à¥¨à¥©à¥ªà¥«à¥¬à¥­à¥®à¥¯à¥¦]/g,function(a){return c[a]})},postformat:function(a){return a.replace(/\d/g,function(a){return b[a]})},meridiem:function(a){return 3>a?"à¤°à¤¾à¤¤à¥€":10>a?"à¤¬à¤¿à¤¹à¤¾à¤¨":15>a?"à¤¦à¤¿à¤‰à¤à¤¸à¥‹":18>a?"à¤¬à¥‡à¤²à¥à¤•à¤¾":20>a?"à¤¸à¤¾à¤à¤":"à¤°à¤¾à¤¤à¥€"},calendar:{sameDay:"[à¤†à¤œ] LT",nextDay:"[à¤­à¥‹à¤²à¥€] LT",nextWeek:"[à¤†à¤‰à¤à¤¦à¥‹] dddd[,] LT",lastDay:"[à¤¹à¤¿à¤œà¥‹] LT",lastWeek:"[à¤—à¤à¤•à¥‹] dddd[,] LT",sameElse:"L"},relativeTime:{future:"%sà¤®à¤¾",past:"%s à¤…à¤—à¤¾à¤¡à¥€",s:"à¤•à¥‡à¤¹à¥€ à¤¸à¤®à¤¯",m:"à¤à¤• à¤®à¤¿à¤¨à¥‡à¤Ÿ",mm:"%d à¤®à¤¿à¤¨à¥‡à¤Ÿ",h:"à¤à¤• à¤˜à¤£à¥à¤Ÿà¤¾",hh:"%d à¤˜à¤£à¥à¤Ÿà¤¾",d:"à¤à¤• à¤¦à¤¿à¤¨",dd:"%d à¤¦à¤¿à¤¨",M:"à¤à¤• à¤®à¤¹à¤¿à¤¨à¤¾",MM:"%d à¤®à¤¹à¤¿à¤¨à¤¾",y:"à¤à¤• à¤¬à¤°à¥à¤·",yy:"%d à¤¬à¤°à¥à¤·"},week:{dow:1,doy:7}})}),function(a){a(bb)}(function(a){var b="jan._feb._mrt._apr._mei_jun._jul._aug._sep._okt._nov._dec.".split("_"),c="jan_feb_mrt_apr_mei_jun_jul_aug_sep_okt_nov_dec".split("_");return a.lang("nl",{months:"januari_februari_maart_april_mei_juni_juli_augustus_september_oktober_november_december".split("_"),monthsShort:function(a,d){return/-MMM-/.test(d)?c[a.month()]:b[a.month()]},weekdays:"zondag_maandag_dinsdag_woensdag_donderdag_vrijdag_zaterdag".split("_"),weekdaysShort:"zo._ma._di._wo._do._vr._za.".split("_"),weekdaysMin:"Zo_Ma_Di_Wo_Do_Vr_Za".split("_"),longDateFormat:{LT:"HH:mm",L:"DD-MM-YYYY",LL:"D MMMM YYYY",LLL:"D MMMM YYYY LT",LLLL:"dddd D MMMM YYYY LT"},calendar:{sameDay:"[vandaag om] LT",nextDay:"[morgen om] LT",nextWeek:"dddd [om] LT",lastDay:"[gisteren om] LT",lastWeek:"[afgelopen] dddd [om] LT",sameElse:"L"},relativeTime:{future:"over %s",past:"%s geleden",s:"een paar seconden",m:"%d minuut",mm:"%d minuten",h:"%d uur",hh:"%d uur",d:"%d dag",dd:"%d dagen",M:"%d maand",MM:"%d maanden",y:"%d jaar",yy:"%d jaar"},ordinal:function(a){return a+(1===a||8===a||a>=20?"ste":"de")},week:{dow:1,doy:4}})}),function(a){a(bb)}(function(a){return a.lang("nn",{months:"januar_februar_mars_april_mai_juni_juli_august_september_oktober_november_desember".split("_"),monthsShort:"jan_feb_mar_apr_mai_jun_jul_aug_sep_okt_nov_des".split("_"),weekdays:"sundag_mÃ¥ndag_tysdag_onsdag_torsdag_fredag_laurdag".split("_"),weekdaysShort:"sun_mÃ¥n_tys_ons_tor_fre_lau".split("_"),weekdaysMin:"su_mÃ¥_ty_on_to_fr_lÃ¸".split("_"),longDateFormat:{LT:"HH:mm",L:"DD.MM.YYYY",LL:"D MMMM YYYY",LLL:"D MMMM YYYY LT",LLLL:"dddd D MMMM YYYY LT"},calendar:{sameDay:"[I dag klokka] LT",nextDay:"[I morgon klokka] LT",nextWeek:"dddd [klokka] LT",lastDay:"[I gÃ¥r klokka] LT",lastWeek:"[FÃ¸regÃ¥ende] dddd [klokka] LT",sameElse:"L"},relativeTime:{future:"om %s",past:"for %s siden",s:"noen sekund",m:"ett minutt",mm:"%d minutt",h:"en time",hh:"%d timar",d:"en dag",dd:"%d dagar",M:"en mÃ¥nad",MM:"%d mÃ¥nader",y:"ett Ã¥r",yy:"%d Ã¥r"},ordinal:"%d.",week:{dow:1,doy:4}})}),function(a){a(bb)}(function(a){function b(a){return 5>a%10&&a%10>1&&1!==~~(a/10)}function c(a,c,d){var e=a+" ";switch(d){case"m":return c?"minuta":"minutÄ™";case"mm":return e+(b(a)?"minuty":"minut");case"h":return c?"godzina":"godzinÄ™";case"hh":return e+(b(a)?"godziny":"godzin");case"MM":return e+(b(a)?"miesiÄ…ce":"miesiÄ™cy");case"yy":return e+(b(a)?"lata":"lat")}}var d="styczeÅ„_luty_marzec_kwiecieÅ„_maj_czerwiec_lipiec_sierpieÅ„_wrzesieÅ„_paÅºdziernik_listopad_grudzieÅ„".split("_"),e="stycznia_lutego_marca_kwietnia_maja_czerwca_lipca_sierpnia_wrzeÅ›nia_paÅºdziernika_listopada_grudnia".split("_");return a.lang("pl",{months:function(a,b){return/D MMMM/.test(b)?e[a.month()]:d[a.month()]},monthsShort:"sty_lut_mar_kwi_maj_cze_lip_sie_wrz_paÅº_lis_gru".split("_"),weekdays:"niedziela_poniedziaÅ‚ek_wtorek_Å›roda_czwartek_piÄ…tek_sobota".split("_"),weekdaysShort:"nie_pon_wt_Å›r_czw_pt_sb".split("_"),weekdaysMin:"N_Pn_Wt_Åšr_Cz_Pt_So".split("_"),longDateFormat:{LT:"HH:mm",L:"DD.MM.YYYY",LL:"D MMMM YYYY",LLL:"D MMMM YYYY LT",LLLL:"dddd, D MMMM YYYY LT"},calendar:{sameDay:"[DziÅ› o] LT",nextDay:"[Jutro o] LT",nextWeek:"[W] dddd [o] LT",lastDay:"[Wczoraj o] LT",lastWeek:function(){switch(this.day()){case 0:return"[W zeszÅ‚Ä… niedzielÄ™ o] LT";case 3:return"[W zeszÅ‚Ä… Å›rodÄ™ o] LT";case 6:return"[W zeszÅ‚Ä… sobotÄ™ o] LT";default:return"[W zeszÅ‚y] dddd [o] LT"}},sameElse:"L"},relativeTime:{future:"za %s",past:"%s temu",s:"kilka sekund",m:c,mm:c,h:c,hh:c,d:"1 dzieÅ„",dd:"%d dni",M:"miesiÄ…c",MM:c,y:"rok",yy:c},ordinal:"%d.",week:{dow:1,doy:4}})}),function(a){a(bb)}(function(a){return a.lang("pt-br",{months:"Janeiro_Fevereiro_MarÃ§o_Abril_Maio_Junho_Julho_Agosto_Setembro_Outubro_Novembro_Dezembro".split("_"),monthsShort:"Jan_Fev_Mar_Abr_Mai_Jun_Jul_Ago_Set_Out_Nov_Dez".split("_"),weekdays:"Domingo_Segunda-feira_TerÃ§a-feira_Quarta-feira_Quinta-feira_Sexta-feira_SÃ¡bado".split("_"),weekdaysShort:"Dom_Seg_Ter_Qua_Qui_Sex_SÃ¡b".split("_"),weekdaysMin:"Dom_2Âª_3Âª_4Âª_5Âª_6Âª_SÃ¡b".split("_"),longDateFormat:{LT:"HH:mm",L:"DD/MM/YYYY",LL:"D [de] MMMM [de] YYYY",LLL:"D [de] MMMM [de] YYYY LT",LLLL:"dddd, D [de] MMMM [de] YYYY LT"},calendar:{sameDay:"[Hoje Ã s] LT",nextDay:"[AmanhÃ£ Ã s] LT",nextWeek:"dddd [Ã s] LT",lastDay:"[Ontem Ã s] LT",lastWeek:function(){return 0===this.day()||6===this.day()?"[Ãšltimo] dddd [Ã s] LT":"[Ãšltima] dddd [Ã s] LT"},sameElse:"L"},relativeTime:{future:"em %s",past:"%s atrÃ¡s",s:"segundos",m:"um minuto",mm:"%d minutos",h:"uma hora",hh:"%d horas",d:"um dia",dd:"%d dias",M:"um mÃªs",MM:"%d meses",y:"um ano",yy:"%d anos"},ordinal:"%d"})}),function(a){a(bb)}(function(a){return a.lang("pt",{months:"Janeiro_Fevereiro_MarÃ§o_Abril_Maio_Junho_Julho_Agosto_Setembro_Outubro_Novembro_Dezembro".split("_"),monthsShort:"Jan_Fev_Mar_Abr_Mai_Jun_Jul_Ago_Set_Out_Nov_Dez".split("_"),weekdays:"Domingo_Segunda-feira_TerÃ§a-feira_Quarta-feira_Quinta-feira_Sexta-feira_SÃ¡bado".split("_"),weekdaysShort:"Dom_Seg_Ter_Qua_Qui_Sex_SÃ¡b".split("_"),weekdaysMin:"Dom_2Âª_3Âª_4Âª_5Âª_6Âª_SÃ¡b".split("_"),longDateFormat:{LT:"HH:mm",L:"DD/MM/YYYY",LL:"D [de] MMMM [de] YYYY",LLL:"D [de] MMMM [de] YYYY LT",LLLL:"dddd, D [de] MMMM [de] YYYY LT"},calendar:{sameDay:"[Hoje Ã s] LT",nextDay:"[AmanhÃ£ Ã s] LT",nextWeek:"dddd [Ã s] LT",lastDay:"[Ontem Ã s] LT",lastWeek:function(){return 0===this.day()||6===this.day()?"[Ãšltimo] dddd [Ã s] LT":"[Ãšltima] dddd [Ã s] LT"},sameElse:"L"},relativeTime:{future:"em %s",past:"%s atrÃ¡s",s:"segundos",m:"um minuto",mm:"%d minutos",h:"uma hora",hh:"%d horas",d:"um dia",dd:"%d dias",M:"um mÃªs",MM:"%d meses",y:"um ano",yy:"%d anos"},ordinal:"%d",week:{dow:1,doy:4}})}),function(a){a(bb)}(function(a){return a.lang("ro",{months:"Ianuarie_Februarie_Martie_Aprilie_Mai_Iunie_Iulie_August_Septembrie_Octombrie_Noiembrie_Decembrie".split("_"),monthsShort:"Ian_Feb_Mar_Apr_Mai_Iun_Iul_Aug_Sep_Oct_Noi_Dec".split("_"),weekdays:"DuminicÄƒ_Luni_MarÅ£i_Miercuri_Joi_Vineri_SÃ¢mbÄƒtÄƒ".split("_"),weekdaysShort:"Dum_Lun_Mar_Mie_Joi_Vin_SÃ¢m".split("_"),weekdaysMin:"Du_Lu_Ma_Mi_Jo_Vi_SÃ¢".split("_"),longDateFormat:{LT:"H:mm",L:"DD/MM/YYYY",LL:"D MMMM YYYY",LLL:"D MMMM YYYY H:mm",LLLL:"dddd, D MMMM YYYY H:mm"},calendar:{sameDay:"[azi la] LT",nextDay:"[mÃ¢ine la] LT",nextWeek:"dddd [la] LT",lastDay:"[ieri la] LT",lastWeek:"[fosta] dddd [la] LT",sameElse:"L"},relativeTime:{future:"peste %s",past:"%s Ã®n urmÄƒ",s:"cÃ¢teva secunde",m:"un minut",mm:"%d minute",h:"o orÄƒ",hh:"%d ore",d:"o zi",dd:"%d zile",M:"o lunÄƒ",MM:"%d luni",y:"un an",yy:"%d ani"},week:{dow:1,doy:7}})}),function(a){a(bb)}(function(a){function b(a,b){var c=a.split("_");return 1===b%10&&11!==b%100?c[0]:b%10>=2&&4>=b%10&&(10>b%100||b%100>=20)?c[1]:c[2]}function c(a,c,d){var e={mm:"Ð¼Ð¸Ð½ÑƒÑ‚Ð°_Ð¼Ð¸Ð½ÑƒÑ‚Ñ‹_Ð¼Ð¸Ð½ÑƒÑ‚",hh:"Ñ‡Ð°Ñ_Ñ‡Ð°ÑÐ°_Ñ‡Ð°ÑÐ¾Ð²",dd:"Ð´ÐµÐ½ÑŒ_Ð´Ð½Ñ_Ð´Ð½ÐµÐ¹",MM:"Ð¼ÐµÑÑÑ†_Ð¼ÐµÑÑÑ†Ð°_Ð¼ÐµÑÑÑ†ÐµÐ²",yy:"Ð³Ð¾Ð´_Ð³Ð¾Ð´Ð°_Ð»ÐµÑ‚"};return"m"===d?c?"Ð¼Ð¸Ð½ÑƒÑ‚Ð°":"Ð¼Ð¸Ð½ÑƒÑ‚Ñƒ":a+" "+b(e[d],+a)}function d(a,b){var c={nominative:"ÑÐ½Ð²Ð°Ñ€ÑŒ_Ñ„ÐµÐ²Ñ€Ð°Ð»ÑŒ_Ð¼Ð°Ñ€Ñ‚_Ð°Ð¿Ñ€ÐµÐ»ÑŒ_Ð¼Ð°Ð¹_Ð¸ÑŽÐ½ÑŒ_Ð¸ÑŽÐ»ÑŒ_Ð°Ð²Ð³ÑƒÑÑ‚_ÑÐµÐ½Ñ‚ÑÐ±Ñ€ÑŒ_Ð¾ÐºÑ‚ÑÐ±Ñ€ÑŒ_Ð½Ð¾ÑÐ±Ñ€ÑŒ_Ð´ÐµÐºÐ°Ð±Ñ€ÑŒ".split("_"),accusative:"ÑÐ½Ð²Ð°Ñ€Ñ_Ñ„ÐµÐ²Ñ€Ð°Ð»Ñ_Ð¼Ð°Ñ€Ñ‚Ð°_Ð°Ð¿Ñ€ÐµÐ»Ñ_Ð¼Ð°Ñ_Ð¸ÑŽÐ½Ñ_Ð¸ÑŽÐ»Ñ_Ð°Ð²Ð³ÑƒÑÑ‚Ð°_ÑÐµÐ½Ñ‚ÑÐ±Ñ€Ñ_Ð¾ÐºÑ‚ÑÐ±Ñ€Ñ_Ð½Ð¾ÑÐ±Ñ€Ñ_Ð´ÐµÐºÐ°Ð±Ñ€Ñ".split("_")},d=/D[oD]?(\[[^\[\]]*\]|\s+)+MMMM?/.test(b)?"accusative":"nominative";return c[d][a.month()]}function e(a,b){var c={nominative:"ÑÐ½Ð²_Ñ„ÐµÐ²_Ð¼Ð°Ñ€_Ð°Ð¿Ñ€_Ð¼Ð°Ð¹_Ð¸ÑŽÐ½ÑŒ_Ð¸ÑŽÐ»ÑŒ_Ð°Ð²Ð³_ÑÐµÐ½_Ð¾ÐºÑ‚_Ð½Ð¾Ñ_Ð´ÐµÐº".split("_"),accusative:"ÑÐ½Ð²_Ñ„ÐµÐ²_Ð¼Ð°Ñ€_Ð°Ð¿Ñ€_Ð¼Ð°Ñ_Ð¸ÑŽÐ½Ñ_Ð¸ÑŽÐ»Ñ_Ð°Ð²Ð³_ÑÐµÐ½_Ð¾ÐºÑ‚_Ð½Ð¾Ñ_Ð´ÐµÐº".split("_")},d=/D[oD]?(\[[^\[\]]*\]|\s+)+MMMM?/.test(b)?"accusative":"nominative";return c[d][a.month()]}function f(a,b){var c={nominative:"Ð²Ð¾ÑÐºÑ€ÐµÑÐµÐ½ÑŒÐµ_Ð¿Ð¾Ð½ÐµÐ´ÐµÐ»ÑŒÐ½Ð¸Ðº_Ð²Ñ‚Ð¾Ñ€Ð½Ð¸Ðº_ÑÑ€ÐµÐ´Ð°_Ñ‡ÐµÑ‚Ð²ÐµÑ€Ð³_Ð¿ÑÑ‚Ð½Ð¸Ñ†Ð°_ÑÑƒÐ±Ð±Ð¾Ñ‚Ð°".split("_"),accusative:"Ð²Ð¾ÑÐºÑ€ÐµÑÐµÐ½ÑŒÐµ_Ð¿Ð¾Ð½ÐµÐ´ÐµÐ»ÑŒÐ½Ð¸Ðº_Ð²Ñ‚Ð¾Ñ€Ð½Ð¸Ðº_ÑÑ€ÐµÐ´Ñƒ_Ñ‡ÐµÑ‚Ð²ÐµÑ€Ð³_Ð¿ÑÑ‚Ð½Ð¸Ñ†Ñƒ_ÑÑƒÐ±Ð±Ð¾Ñ‚Ñƒ".split("_")},d=/\[ ?[Ð’Ð²] ?(?:Ð¿Ñ€Ð¾ÑˆÐ»ÑƒÑŽ|ÑÐ»ÐµÐ´ÑƒÑŽÑ‰ÑƒÑŽ)? ?\] ?dddd/.test(b)?"accusative":"nominative";return c[d][a.day()]}return a.lang("ru",{months:d,monthsShort:e,weekdays:f,weekdaysShort:"Ð²Ñ_Ð¿Ð½_Ð²Ñ‚_ÑÑ€_Ñ‡Ñ‚_Ð¿Ñ‚_ÑÐ±".split("_"),weekdaysMin:"Ð²Ñ_Ð¿Ð½_Ð²Ñ‚_ÑÑ€_Ñ‡Ñ‚_Ð¿Ñ‚_ÑÐ±".split("_"),monthsParse:[/^ÑÐ½Ð²/i,/^Ñ„ÐµÐ²/i,/^Ð¼Ð°Ñ€/i,/^Ð°Ð¿Ñ€/i,/^Ð¼Ð°[Ð¹|Ñ]/i,/^Ð¸ÑŽÐ½/i,/^Ð¸ÑŽÐ»/i,/^Ð°Ð²Ð³/i,/^ÑÐµÐ½/i,/^Ð¾ÐºÑ‚/i,/^Ð½Ð¾Ñ/i,/^Ð´ÐµÐº/i],longDateFormat:{LT:"HH:mm",L:"DD.MM.YYYY",LL:"D MMMM YYYY Ð³.",LLL:"D MMMM YYYY Ð³., LT",LLLL:"dddd, D MMMM YYYY Ð³., LT"},calendar:{sameDay:"[Ð¡ÐµÐ³Ð¾Ð´Ð½Ñ Ð²] LT",nextDay:"[Ð—Ð°Ð²Ñ‚Ñ€Ð° Ð²] LT",lastDay:"[Ð’Ñ‡ÐµÑ€Ð° Ð²] LT",nextWeek:function(){return 2===this.day()?"[Ð’Ð¾] dddd [Ð²] LT":"[Ð’] dddd [Ð²] LT"},lastWeek:function(){switch(this.day()){case 0:return"[Ð’ Ð¿Ñ€Ð¾ÑˆÐ»Ð¾Ðµ] dddd [Ð²] LT";case 1:case 2:case 4:return"[Ð’ Ð¿Ñ€Ð¾ÑˆÐ»Ñ‹Ð¹] dddd [Ð²] LT";case 3:case 5:case 6:return"[Ð’ Ð¿Ñ€Ð¾ÑˆÐ»ÑƒÑŽ] dddd [Ð²] LT"}},sameElse:"L"},relativeTime:{future:"Ñ‡ÐµÑ€ÐµÐ· %s",past:"%s Ð½Ð°Ð·Ð°Ð´",s:"Ð½ÐµÑÐºÐ¾Ð»ÑŒÐºÐ¾ ÑÐµÐºÑƒÐ½Ð´",m:c,mm:c,h:"Ñ‡Ð°Ñ",hh:c,d:"Ð´ÐµÐ½ÑŒ",dd:c,M:"Ð¼ÐµÑÑÑ†",MM:c,y:"Ð³Ð¾Ð´",yy:c},meridiem:function(a){return 4>a?"Ð½Ð¾Ñ‡Ð¸":12>a?"ÑƒÑ‚Ñ€Ð°":17>a?"Ð´Ð½Ñ":"Ð²ÐµÑ‡ÐµÑ€Ð°"},ordinal:function(a,b){switch(b){case"M":case"d":case"DDD":return a+"-Ð¹";case"D":return a+"-Ð³Ð¾";case"w":case"W":return a+"-Ñ";default:return a}},week:{dow:1,doy:7}})}),function(a){a(bb)}(function(a){function b(a){return a>1&&5>a}function c(a,c,d,e){var f=a+" ";switch(d){case"s":return c||e?"pÃ¡r sekÃºnd":"pÃ¡r sekundami";case"m":return c?"minÃºta":e?"minÃºtu":"minÃºtou";case"mm":return c||e?f+(b(a)?"minÃºty":"minÃºt"):f+"minÃºtami";break;case"h":return c?"hodina":e?"hodinu":"hodinou";case"hh":return c||e?f+(b(a)?"hodiny":"hodÃ­n"):f+"hodinami";break;case"d":return c||e?"deÅˆ":"dÅˆom";case"dd":return c||e?f+(b(a)?"dni":"dnÃ­"):f+"dÅˆami";break;case"M":return c||e?"mesiac":"mesiacom";case"MM":return c||e?f+(b(a)?"mesiace":"mesiacov"):f+"mesiacmi";break;case"y":return c||e?"rok":"rokom";case"yy":return c||e?f+(b(a)?"roky":"rokov"):f+"rokmi"}}var d="januÃ¡r_februÃ¡r_marec_aprÃ­l_mÃ¡j_jÃºn_jÃºl_august_september_oktÃ³ber_november_december".split("_"),e="jan_feb_mar_apr_mÃ¡j_jÃºn_jÃºl_aug_sep_okt_nov_dec".split("_");return a.lang("sk",{months:d,monthsShort:e,monthsParse:function(a,b){var c,d=[];for(c=0;12>c;c++)d[c]=new RegExp("^"+a[c]+"$|^"+b[c]+"$","i");return d}(d,e),weekdays:"nedeÄ¾a_pondelok_utorok_streda_Å¡tvrtok_piatok_sobota".split("_"),weekdaysShort:"ne_po_ut_st_Å¡t_pi_so".split("_"),weekdaysMin:"ne_po_ut_st_Å¡t_pi_so".split("_"),longDateFormat:{LT:"H:mm",L:"DD.MM.YYYY",LL:"D. MMMM YYYY",LLL:"D. MMMM YYYY LT",LLLL:"dddd D. MMMM YYYY LT"},calendar:{sameDay:"[dnes o] LT",nextDay:"[zajtra o] LT",nextWeek:function(){switch(this.day()){case 0:return"[v nedeÄ¾u o] LT";case 1:case 2:return"[v] dddd [o] LT";case 3:return"[v stredu o] LT";case 4:return"[vo Å¡tvrtok o] LT";case 5:return"[v piatok o] LT";case 6:return"[v sobotu o] LT"}},lastDay:"[vÄera o] LT",lastWeek:function(){switch(this.day()){case 0:return"[minulÃº nedeÄ¾u o] LT";case 1:case 2:return"[minulÃ½] dddd [o] LT";case 3:return"[minulÃº stredu o] LT";case 4:case 5:return"[minulÃ½] dddd [o] LT";case 6:return"[minulÃº sobotu o] LT"}},sameElse:"L"},relativeTime:{future:"za %s",past:"pred %s",s:c,m:c,mm:c,h:c,hh:c,d:c,dd:c,M:c,MM:c,y:c,yy:c},ordinal:"%d.",week:{dow:1,doy:4}})}),function(a){a(bb)}(function(a){function b(a,b,c){var d=a+" ";switch(c){case"m":return b?"ena minuta":"eno minuto";case"mm":return d+=1===a?"minuta":2===a?"minuti":3===a||4===a?"minute":"minut";case"h":return b?"ena ura":"eno uro";case"hh":return d+=1===a?"ura":2===a?"uri":3===a||4===a?"ure":"ur";case"dd":return d+=1===a?"dan":"dni";case"MM":return d+=1===a?"mesec":2===a?"meseca":3===a||4===a?"mesece":"mesecev";case"yy":return d+=1===a?"leto":2===a?"leti":3===a||4===a?"leta":"let"}}return a.lang("sl",{months:"januar_februar_marec_april_maj_junij_julij_avgust_september_oktober_november_december".split("_"),monthsShort:"jan._feb._mar._apr._maj._jun._jul._avg._sep._okt._nov._dec.".split("_"),weekdays:"nedelja_ponedeljek_torek_sreda_Äetrtek_petek_sobota".split("_"),weekdaysShort:"ned._pon._tor._sre._Äet._pet._sob.".split("_"),weekdaysMin:"ne_po_to_sr_Äe_pe_so".split("_"),longDateFormat:{LT:"H:mm",L:"DD. MM. YYYY",LL:"D. MMMM YYYY",LLL:"D. MMMM YYYY LT",LLLL:"dddd, D. MMMM YYYY LT"},calendar:{sameDay:"[danes ob] LT",nextDay:"[jutri ob] LT",nextWeek:function(){switch(this.day()){case 0:return"[v] [nedeljo] [ob] LT";case 3:return"[v] [sredo] [ob] LT";case 6:return"[v] [soboto] [ob] LT";case 1:case 2:case 4:case 5:return"[v] dddd [ob] LT"}},lastDay:"[vÄeraj ob] LT",lastWeek:function(){switch(this.day()){case 0:case 3:case 6:return"[prejÅ¡nja] dddd [ob] LT";case 1:case 2:case 4:case 5:return"[prejÅ¡nji] dddd [ob] LT"}},sameElse:"L"},relativeTime:{future:"Äez %s",past:"%s nazaj",s:"nekaj sekund",m:b,mm:b,h:b,hh:b,d:"en dan",dd:b,M:"en mesec",MM:b,y:"eno leto",yy:b},ordinal:"%d.",week:{dow:1,doy:7}})}),function(a){a(bb)}(function(a){return a.lang("sq",{months:"Janar_Shkurt_Mars_Prill_Maj_Qershor_Korrik_Gusht_Shtator_Tetor_NÃ«ntor_Dhjetor".split("_"),monthsShort:"Jan_Shk_Mar_Pri_Maj_Qer_Kor_Gus_Sht_Tet_NÃ«n_Dhj".split("_"),weekdays:"E Diel_E HÃ«nÃ«_E Marte_E MÃ«rkure_E Enjte_E Premte_E ShtunÃ«".split("_"),weekdaysShort:"Die_HÃ«n_Mar_MÃ«r_Enj_Pre_Sht".split("_"),weekdaysMin:"D_H_Ma_MÃ«_E_P_Sh".split("_"),longDateFormat:{LT:"HH:mm",L:"DD/MM/YYYY",LL:"D MMMM YYYY",LLL:"D MMMM YYYY LT",LLLL:"dddd, D MMMM YYYY LT"},calendar:{sameDay:"[Sot nÃ«] LT",nextDay:"[Neser nÃ«] LT",nextWeek:"dddd [nÃ«] LT",lastDay:"[Dje nÃ«] LT",lastWeek:"dddd [e kaluar nÃ«] LT",sameElse:"L"},relativeTime:{future:"nÃ« %s",past:"%s me parÃ«",s:"disa seconda",m:"njÃ« minut",mm:"%d minutea",h:"njÃ« orÃ«",hh:"%d orÃ«",d:"njÃ« ditÃ«",dd:"%d ditÃ«",M:"njÃ« muaj",MM:"%d muaj",y:"njÃ« vit",yy:"%d vite"},ordinal:"%d.",week:{dow:1,doy:4}})}),function(a){a(bb)}(function(a){return a.lang("sv",{months:"januari_februari_mars_april_maj_juni_juli_augusti_september_oktober_november_december".split("_"),monthsShort:"jan_feb_mar_apr_maj_jun_jul_aug_sep_okt_nov_dec".split("_"),weekdays:"sÃ¶ndag_mÃ¥ndag_tisdag_onsdag_torsdag_fredag_lÃ¶rdag".split("_"),weekdaysShort:"sÃ¶n_mÃ¥n_tis_ons_tor_fre_lÃ¶r".split("_"),weekdaysMin:"sÃ¶_mÃ¥_ti_on_to_fr_lÃ¶".split("_"),longDateFormat:{LT:"HH:mm",L:"YYYY-MM-DD",LL:"D MMMM YYYY",LLL:"D MMMM YYYY LT",LLLL:"dddd D MMMM YYYY LT"},calendar:{sameDay:"[Idag] LT",nextDay:"[Imorgon] LT",lastDay:"[IgÃ¥r] LT",nextWeek:"dddd LT",lastWeek:"[FÃ¶rra] dddd[en] LT",sameElse:"L"},relativeTime:{future:"om %s",past:"fÃ¶r %s sedan",s:"nÃ¥gra sekunder",m:"en minut",mm:"%d minuter",h:"en timme",hh:"%d timmar",d:"en dag",dd:"%d dagar",M:"en mÃ¥nad",MM:"%d mÃ¥nader",y:"ett Ã¥r",yy:"%d Ã¥r"},ordinal:function(a){var b=a%10,c=1===~~(a%100/10)?"e":1===b?"a":2===b?"a":3===b?"e":"e";return a+c},week:{dow:1,doy:4}})}),function(a){a(bb)}(function(a){return a.lang("th",{months:"à¸¡à¸à¸£à¸²à¸„à¸¡_à¸à¸¸à¸¡à¸ à¸²à¸žà¸±à¸™à¸˜à¹Œ_à¸¡à¸µà¸™à¸²à¸„à¸¡_à¹€à¸¡à¸©à¸²à¸¢à¸™_à¸žà¸¤à¸©à¸ à¸²à¸„à¸¡_à¸¡à¸´à¸–à¸¸à¸™à¸²à¸¢à¸™_à¸à¸£à¸à¸Žà¸²à¸„à¸¡_à¸ªà¸´à¸‡à¸«à¸²à¸„à¸¡_à¸à¸±à¸™à¸¢à¸²à¸¢à¸™_à¸•à¸¸à¸¥à¸²à¸„à¸¡_à¸žà¸¤à¸¨à¸ˆà¸´à¸à¸²à¸¢à¸™_à¸˜à¸±à¸™à¸§à¸²à¸„à¸¡".split("_"),monthsShort:"à¸¡à¸à¸£à¸²_à¸à¸¸à¸¡à¸ à¸²_à¸¡à¸µà¸™à¸²_à¹€à¸¡à¸©à¸²_à¸žà¸¤à¸©à¸ à¸²_à¸¡à¸´à¸–à¸¸à¸™à¸²_à¸à¸£à¸à¸Žà¸²_à¸ªà¸´à¸‡à¸«à¸²_à¸à¸±à¸™à¸¢à¸²_à¸•à¸¸à¸¥à¸²_à¸žà¸¤à¸¨à¸ˆà¸´à¸à¸²_à¸˜à¸±à¸™à¸§à¸²".split("_"),weekdays:"à¸­à¸²à¸—à¸´à¸•à¸¢à¹Œ_à¸ˆà¸±à¸™à¸—à¸£à¹Œ_à¸­à¸±à¸‡à¸„à¸²à¸£_à¸žà¸¸à¸˜_à¸žà¸¤à¸«à¸±à¸ªà¸šà¸”à¸µ_à¸¨à¸¸à¸à¸£à¹Œ_à¹€à¸ªà¸²à¸£à¹Œ".split("_"),weekdaysShort:"à¸­à¸²à¸—à¸´à¸•à¸¢à¹Œ_à¸ˆà¸±à¸™à¸—à¸£à¹Œ_à¸­à¸±à¸‡à¸„à¸²à¸£_à¸žà¸¸à¸˜_à¸žà¸¤à¸«à¸±à¸ª_à¸¨à¸¸à¸à¸£à¹Œ_à¹€à¸ªà¸²à¸£à¹Œ".split("_"),weekdaysMin:"à¸­à¸²._à¸ˆ._à¸­._à¸ž._à¸žà¸¤._à¸¨._à¸ª.".split("_"),longDateFormat:{LT:"H à¸™à¸²à¸¬à¸´à¸à¸² m à¸™à¸²à¸—à¸µ",L:"YYYY/MM/DD",LL:"D MMMM YYYY",LLL:"D MMMM YYYY à¹€à¸§à¸¥à¸² LT",LLLL:"à¸§à¸±à¸™ddddà¸—à¸µà¹ˆ D MMMM YYYY à¹€à¸§à¸¥à¸² LT"},meridiem:function(a){return 12>a?"à¸à¹ˆà¸­à¸™à¹€à¸—à¸µà¹ˆà¸¢à¸‡":"à¸«à¸¥à¸±à¸‡à¹€à¸—à¸µà¹ˆà¸¢à¸‡"},calendar:{sameDay:"[à¸§à¸±à¸™à¸™à¸µà¹‰ à¹€à¸§à¸¥à¸²] LT",nextDay:"[à¸žà¸£à¸¸à¹ˆà¸‡à¸™à¸µà¹‰ à¹€à¸§à¸¥à¸²] LT",nextWeek:"dddd[à¸«à¸™à¹‰à¸² à¹€à¸§à¸¥à¸²] LT",lastDay:"[à¹€à¸¡à¸·à¹ˆà¸­à¸§à¸²à¸™à¸™à¸µà¹‰ à¹€à¸§à¸¥à¸²] LT",lastWeek:"[à¸§à¸±à¸™]dddd[à¸—à¸µà¹ˆà¹à¸¥à¹‰à¸§ à¹€à¸§à¸¥à¸²] LT",sameElse:"L"},relativeTime:{future:"à¸­à¸µà¸ %s",past:"%sà¸—à¸µà¹ˆà¹à¸¥à¹‰à¸§",s:"à¹„à¸¡à¹ˆà¸à¸µà¹ˆà¸§à¸´à¸™à¸²à¸—à¸µ",m:"1 à¸™à¸²à¸—à¸µ",mm:"%d à¸™à¸²à¸—à¸µ",h:"1 à¸Šà¸±à¹ˆà¸§à¹‚à¸¡à¸‡",hh:"%d à¸Šà¸±à¹ˆà¸§à¹‚à¸¡à¸‡",d:"1 à¸§à¸±à¸™",dd:"%d à¸§à¸±à¸™",M:"1 à¹€à¸”à¸·à¸­à¸™",MM:"%d à¹€à¸”à¸·à¸­à¸™",y:"1 à¸›à¸µ",yy:"%d à¸›à¸µ"}})}),function(a){a(bb)}(function(a){return a.lang("tl-ph",{months:"Enero_Pebrero_Marso_Abril_Mayo_Hunyo_Hulyo_Agosto_Setyembre_Oktubre_Nobyembre_Disyembre".split("_"),monthsShort:"Ene_Peb_Mar_Abr_May_Hun_Hul_Ago_Set_Okt_Nob_Dis".split("_"),weekdays:"Linggo_Lunes_Martes_Miyerkules_Huwebes_Biyernes_Sabado".split("_"),weekdaysShort:"Lin_Lun_Mar_Miy_Huw_Biy_Sab".split("_"),weekdaysMin:"Li_Lu_Ma_Mi_Hu_Bi_Sab".split("_"),longDateFormat:{LT:"HH:mm",L:"MM/D/YYYY",LL:"MMMM D, YYYY",LLL:"MMMM D, YYYY LT",LLLL:"dddd, MMMM DD, YYYY LT"},calendar:{sameDay:"[Ngayon sa] LT",nextDay:"[Bukas sa] LT",nextWeek:"dddd [sa] LT",lastDay:"[Kahapon sa] LT",lastWeek:"dddd [huling linggo] LT",sameElse:"L"},relativeTime:{future:"sa loob ng %s",past:"%s ang nakalipas",s:"ilang segundo",m:"isang minuto",mm:"%d minuto",h:"isang oras",hh:"%d oras",d:"isang araw",dd:"%d araw",M:"isang buwan",MM:"%d buwan",y:"isang taon",yy:"%d taon"},ordinal:function(a){return a},week:{dow:1,doy:4}})}),function(a){a(bb)}(function(a){var b={1:"'inci",5:"'inci",8:"'inci",70:"'inci",80:"'inci",2:"'nci",7:"'nci",20:"'nci",50:"'nci",3:"'Ã¼ncÃ¼",4:"'Ã¼ncÃ¼",100:"'Ã¼ncÃ¼",6:"'ncÄ±",9:"'uncu",10:"'uncu",30:"'uncu",60:"'Ä±ncÄ±",90:"'Ä±ncÄ±"};return a.lang("tr",{months:"Ocak_Åžubat_Mart_Nisan_MayÄ±s_Haziran_Temmuz_AÄŸustos_EylÃ¼l_Ekim_KasÄ±m_AralÄ±k".split("_"),monthsShort:"Oca_Åžub_Mar_Nis_May_Haz_Tem_AÄŸu_Eyl_Eki_Kas_Ara".split("_"),weekdays:"Pazar_Pazartesi_SalÄ±_Ã‡arÅŸamba_PerÅŸembe_Cuma_Cumartesi".split("_"),weekdaysShort:"Paz_Pts_Sal_Ã‡ar_Per_Cum_Cts".split("_"),weekdaysMin:"Pz_Pt_Sa_Ã‡a_Pe_Cu_Ct".split("_"),longDateFormat:{LT:"HH:mm",L:"DD.MM.YYYY",LL:"D MMMM YYYY",LLL:"D MMMM YYYY LT",LLLL:"dddd, D MMMM YYYY LT"},calendar:{sameDay:"[bugÃ¼n saat] LT",nextDay:"[yarÄ±n saat] LT",nextWeek:"[haftaya] dddd [saat] LT",lastDay:"[dÃ¼n] LT",lastWeek:"[geÃ§en hafta] dddd [saat] LT",sameElse:"L"},relativeTime:{future:"%s sonra",past:"%s Ã¶nce",s:"birkaÃ§ saniye",m:"bir dakika",mm:"%d dakika",h:"bir saat",hh:"%d saat",d:"bir gÃ¼n",dd:"%d gÃ¼n",M:"bir ay",MM:"%d ay",y:"bir yÄ±l",yy:"%d yÄ±l"},ordinal:function(a){if(0===a)return a+"'Ä±ncÄ±";var c=a%10,d=a%100-c,e=a>=100?100:null;return a+(b[c]||b[d]||b[e])},week:{dow:1,doy:7}})}),function(a){a(bb)}(function(a){return a.lang("tzm-la",{months:"innayr_brË¤ayrË¤_marË¤sË¤_ibrir_mayyw_ywnyw_ywlywz_É£wÅ¡t_Å¡wtanbir_ktË¤wbrË¤_nwwanbir_dwjnbir".split("_"),monthsShort:"innayr_brË¤ayrË¤_marË¤sË¤_ibrir_mayyw_ywnyw_ywlywz_É£wÅ¡t_Å¡wtanbir_ktË¤wbrË¤_nwwanbir_dwjnbir".split("_"),weekdays:"asamas_aynas_asinas_akras_akwas_asimwas_asiá¸yas".split("_"),weekdaysShort:"asamas_aynas_asinas_akras_akwas_asimwas_asiá¸yas".split("_"),weekdaysMin:"asamas_aynas_asinas_akras_akwas_asimwas_asiá¸yas".split("_"),longDateFormat:{LT:"HH:mm",L:"DD/MM/YYYY",LL:"D MMMM YYYY",LLL:"D MMMM YYYY LT",LLLL:"dddd D MMMM YYYY LT"},calendar:{sameDay:"[asdkh g] LT",nextDay:"[aska g] LT",nextWeek:"dddd [g] LT",lastDay:"[assant g] LT",lastWeek:"dddd [g] LT",sameElse:"L"},relativeTime:{future:"dadkh s yan %s",past:"yan %s",s:"imik",m:"minuá¸",mm:"%d minuá¸",h:"saÉ›a",hh:"%d tassaÉ›in",d:"ass",dd:"%d ossan",M:"ayowr",MM:"%d iyyirn",y:"asgas",yy:"%d isgasn"},week:{dow:6,doy:12}})}),function(a){a(bb)}(function(a){return a.lang("tzm",{months:"âµ‰âµâµâ´°âµ¢âµ”_â´±âµ•â´°âµ¢âµ•_âµŽâ´°âµ•âµš_âµ‰â´±âµ”âµ‰âµ”_âµŽâ´°âµ¢âµ¢âµ“_âµ¢âµ“âµâµ¢âµ“_âµ¢âµ“âµâµ¢âµ“âµ£_âµ–âµ“âµ›âµœ_âµ›âµ“âµœâ´°âµâ´±âµ‰âµ”_â´½âµŸâµ“â´±âµ•_âµâµ“âµ¡â´°âµâ´±âµ‰âµ”_â´·âµ“âµŠâµâ´±âµ‰âµ”".split("_"),monthsShort:"âµ‰âµâµâ´°âµ¢âµ”_â´±âµ•â´°âµ¢âµ•_âµŽâ´°âµ•âµš_âµ‰â´±âµ”âµ‰âµ”_âµŽâ´°âµ¢âµ¢âµ“_âµ¢âµ“âµâµ¢âµ“_âµ¢âµ“âµâµ¢âµ“âµ£_âµ–âµ“âµ›âµœ_âµ›âµ“âµœâ´°âµâ´±âµ‰âµ”_â´½âµŸâµ“â´±âµ•_âµâµ“âµ¡â´°âµâ´±âµ‰âµ”_â´·âµ“âµŠâµâ´±âµ‰âµ”".split("_"),weekdays:"â´°âµ™â´°âµŽâ´°âµ™_â´°âµ¢âµâ´°âµ™_â´°âµ™âµ‰âµâ´°âµ™_â´°â´½âµ”â´°âµ™_â´°â´½âµ¡â´°âµ™_â´°âµ™âµ‰âµŽâµ¡â´°âµ™_â´°âµ™âµ‰â´¹âµ¢â´°âµ™".split("_"),weekdaysShort:"â´°âµ™â´°âµŽâ´°âµ™_â´°âµ¢âµâ´°âµ™_â´°âµ™âµ‰âµâ´°âµ™_â´°â´½âµ”â´°âµ™_â´°â´½âµ¡â´°âµ™_â´°âµ™âµ‰âµŽâµ¡â´°âµ™_â´°âµ™âµ‰â´¹âµ¢â´°âµ™".split("_"),weekdaysMin:"â´°âµ™â´°âµŽâ´°âµ™_â´°âµ¢âµâ´°âµ™_â´°âµ™âµ‰âµâ´°âµ™_â´°â´½âµ”â´°âµ™_â´°â´½âµ¡â´°âµ™_â´°âµ™âµ‰âµŽâµ¡â´°âµ™_â´°âµ™âµ‰â´¹âµ¢â´°âµ™".split("_"),longDateFormat:{LT:"HH:mm",L:"DD/MM/YYYY",LL:"D MMMM YYYY",LLL:"D MMMM YYYY LT",LLLL:"dddd D MMMM YYYY LT"},calendar:{sameDay:"[â´°âµ™â´·âµ… â´´] LT",nextDay:"[â´°âµ™â´½â´° â´´] LT",nextWeek:"dddd [â´´] LT",lastDay:"[â´°âµšâ´°âµâµœ â´´] LT",lastWeek:"dddd [â´´] LT",sameElse:"L"},relativeTime:{future:"â´·â´°â´·âµ… âµ™ âµ¢â´°âµ %s",past:"âµ¢â´°âµ %s",s:"âµ‰âµŽâµ‰â´½",m:"âµŽâµ‰âµâµ“â´º",mm:"%d âµŽâµ‰âµâµ“â´º",h:"âµ™â´°âµ„â´°",hh:"%d âµœâ´°âµ™âµ™â´°âµ„âµ‰âµ",d:"â´°âµ™âµ™",dd:"%d oâµ™âµ™â´°âµ",M:"â´°âµ¢oâµ“âµ”",MM:"%d âµ‰âµ¢âµ¢âµ‰âµ”âµ",y:"â´°âµ™â´³â´°âµ™",yy:"%d âµ‰âµ™â´³â´°âµ™âµ"},week:{dow:6,doy:12}})}),function(a){a(bb)}(function(a){function b(a,b){var c=a.split("_");return 1===b%10&&11!==b%100?c[0]:b%10>=2&&4>=b%10&&(10>b%100||b%100>=20)?c[1]:c[2]}function c(a,c,d){var e={mm:"Ñ…Ð²Ð¸Ð»Ð¸Ð½Ð°_Ñ…Ð²Ð¸Ð»Ð¸Ð½Ð¸_Ñ…Ð²Ð¸Ð»Ð¸Ð½",hh:"Ð³Ð¾Ð´Ð¸Ð½Ð°_Ð³Ð¾Ð´Ð¸Ð½Ð¸_Ð³Ð¾Ð´Ð¸Ð½",dd:"Ð´ÐµÐ½ÑŒ_Ð´Ð½Ñ–_Ð´Ð½Ñ–Ð²",MM:"Ð¼Ñ–ÑÑÑ†ÑŒ_Ð¼Ñ–ÑÑÑ†Ñ–_Ð¼Ñ–ÑÑÑ†Ñ–Ð²",yy:"Ñ€Ñ–Ðº_Ñ€Ð¾ÐºÐ¸_Ñ€Ð¾ÐºÑ–Ð²"};return"m"===d?c?"Ñ…Ð²Ð¸Ð»Ð¸Ð½Ð°":"Ñ…Ð²Ð¸Ð»Ð¸Ð½Ñƒ":"h"===d?c?"Ð³Ð¾Ð´Ð¸Ð½Ð°":"Ð³Ð¾Ð´Ð¸Ð½Ñƒ":a+" "+b(e[d],+a)}function d(a,b){var c={nominative:"ÑÑ–Ñ‡ÐµÐ½ÑŒ_Ð»ÑŽÑ‚Ð¸Ð¹_Ð±ÐµÑ€ÐµÐ·ÐµÐ½ÑŒ_ÐºÐ²Ñ–Ñ‚ÐµÐ½ÑŒ_Ñ‚Ñ€Ð°Ð²ÐµÐ½ÑŒ_Ñ‡ÐµÑ€Ð²ÐµÐ½ÑŒ_Ð»Ð¸Ð¿ÐµÐ½ÑŒ_ÑÐµÑ€Ð¿ÐµÐ½ÑŒ_Ð²ÐµÑ€ÐµÑÐµÐ½ÑŒ_Ð¶Ð¾Ð²Ñ‚ÐµÐ½ÑŒ_Ð»Ð¸ÑÑ‚Ð¾Ð¿Ð°Ð´_Ð³Ñ€ÑƒÐ´ÐµÐ½ÑŒ".split("_"),accusative:"ÑÑ–Ñ‡Ð½Ñ_Ð»ÑŽÑ‚Ð¾Ð³Ð¾_Ð±ÐµÑ€ÐµÐ·Ð½Ñ_ÐºÐ²Ñ–Ñ‚Ð½Ñ_Ñ‚Ñ€Ð°Ð²Ð½Ñ_Ñ‡ÐµÑ€Ð²Ð½Ñ_Ð»Ð¸Ð¿Ð½Ñ_ÑÐµÑ€Ð¿Ð½Ñ_Ð²ÐµÑ€ÐµÑÐ½Ñ_Ð¶Ð¾Ð²Ñ‚Ð½Ñ_Ð»Ð¸ÑÑ‚Ð¾Ð¿Ð°Ð´Ð°_Ð³Ñ€ÑƒÐ´Ð½Ñ".split("_")},d=/D[oD]? *MMMM?/.test(b)?"accusative":"nominative";return c[d][a.month()]}function e(a,b){var c={nominative:"Ð½ÐµÐ´Ñ–Ð»Ñ_Ð¿Ð¾Ð½ÐµÐ´Ñ–Ð»Ð¾Ðº_Ð²Ñ–Ð²Ñ‚Ð¾Ñ€Ð¾Ðº_ÑÐµÑ€ÐµÐ´Ð°_Ñ‡ÐµÑ‚Ð²ÐµÑ€_Ð¿â€™ÑÑ‚Ð½Ð¸Ñ†Ñ_ÑÑƒÐ±Ð¾Ñ‚Ð°".split("_"),accusative:"Ð½ÐµÐ´Ñ–Ð»ÑŽ_Ð¿Ð¾Ð½ÐµÐ´Ñ–Ð»Ð¾Ðº_Ð²Ñ–Ð²Ñ‚Ð¾Ñ€Ð¾Ðº_ÑÐµÑ€ÐµÐ´Ñƒ_Ñ‡ÐµÑ‚Ð²ÐµÑ€_Ð¿â€™ÑÑ‚Ð½Ð¸Ñ†ÑŽ_ÑÑƒÐ±Ð¾Ñ‚Ñƒ".split("_"),genitive:"Ð½ÐµÐ´Ñ–Ð»Ñ–_Ð¿Ð¾Ð½ÐµÐ´Ñ–Ð»ÐºÐ°_Ð²Ñ–Ð²Ñ‚Ð¾Ñ€ÐºÐ°_ÑÐµÑ€ÐµÐ´Ð¸_Ñ‡ÐµÑ‚Ð²ÐµÑ€Ð³Ð°_Ð¿â€™ÑÑ‚Ð½Ð¸Ñ†Ñ–_ÑÑƒÐ±Ð¾Ñ‚Ð¸".split("_")},d=/(\[[Ð’Ð²Ð£Ñƒ]\]) ?dddd/.test(b)?"accusative":/\[?(?:Ð¼Ð¸Ð½ÑƒÐ»Ð¾Ñ—|Ð½Ð°ÑÑ‚ÑƒÐ¿Ð½Ð¾Ñ—)? ?\] ?dddd/.test(b)?"genitive":"nominative";return c[d][a.day()]}function f(a){return function(){return a+"Ð¾"+(11===this.hours()?"Ð±":"")+"] LT"}}return a.lang("uk",{months:d,monthsShort:"ÑÑ–Ñ‡_Ð»ÑŽÑ‚_Ð±ÐµÑ€_ÐºÐ²Ñ–Ñ‚_Ñ‚Ñ€Ð°Ð²_Ñ‡ÐµÑ€Ð²_Ð»Ð¸Ð¿_ÑÐµÑ€Ð¿_Ð²ÐµÑ€_Ð¶Ð¾Ð²Ñ‚_Ð»Ð¸ÑÑ‚_Ð³Ñ€ÑƒÐ´".split("_"),weekdays:e,weekdaysShort:"Ð½Ð´_Ð¿Ð½_Ð²Ñ‚_ÑÑ€_Ñ‡Ñ‚_Ð¿Ñ‚_ÑÐ±".split("_"),weekdaysMin:"Ð½Ð´_Ð¿Ð½_Ð²Ñ‚_ÑÑ€_Ñ‡Ñ‚_Ð¿Ñ‚_ÑÐ±".split("_"),longDateFormat:{LT:"HH:mm",L:"DD.MM.YYYY",LL:"D MMMM YYYY Ñ€.",LLL:"D MMMM YYYY Ñ€., LT",LLLL:"dddd, D MMMM YYYY Ñ€., LT"},calendar:{sameDay:f("[Ð¡ÑŒÐ¾Ð³Ð¾Ð´Ð½Ñ– "),nextDay:f("[Ð—Ð°Ð²Ñ‚Ñ€Ð° "),lastDay:f("[Ð’Ñ‡Ð¾Ñ€Ð° "),nextWeek:f("[Ð£] dddd ["),lastWeek:function(){switch(this.day()){case 0:case 3:case 5:case 6:return f("[ÐœÐ¸Ð½ÑƒÐ»Ð¾Ñ—] dddd [").call(this);case 1:case 2:case 4:return f("[ÐœÐ¸Ð½ÑƒÐ»Ð¾Ð³Ð¾] dddd [").call(this)}},sameElse:"L"},relativeTime:{future:"Ð·Ð° %s",past:"%s Ñ‚Ð¾Ð¼Ñƒ",s:"Ð´ÐµÐºÑ–Ð»ÑŒÐºÐ° ÑÐµÐºÑƒÐ½Ð´",m:c,mm:c,h:"Ð³Ð¾Ð´Ð¸Ð½Ñƒ",hh:c,d:"Ð´ÐµÐ½ÑŒ",dd:c,M:"Ð¼Ñ–ÑÑÑ†ÑŒ",MM:c,y:"Ñ€Ñ–Ðº",yy:c},meridiem:function(a){return 4>a?"Ð½Ð¾Ñ‡Ñ–":12>a?"Ñ€Ð°Ð½ÐºÑƒ":17>a?"Ð´Ð½Ñ":"Ð²ÐµÑ‡Ð¾Ñ€Ð°"},ordinal:function(a,b){switch(b){case"M":case"d":case"DDD":case"w":case"W":return a+"-Ð¹";case"D":return a+"-Ð³Ð¾";default:return a}},week:{dow:1,doy:7}})}),function(a){a(bb)}(function(a){return a.lang("uz",{months:"ÑÐ½Ð²Ð°Ñ€ÑŒ_Ñ„ÐµÐ²Ñ€Ð°Ð»ÑŒ_Ð¼Ð°Ñ€Ñ‚_Ð°Ð¿Ñ€ÐµÐ»ÑŒ_Ð¼Ð°Ð¹_Ð¸ÑŽÐ½ÑŒ_Ð¸ÑŽÐ»ÑŒ_Ð°Ð²Ð³ÑƒÑÑ‚_ÑÐµÐ½Ñ‚ÑÐ±Ñ€ÑŒ_Ð¾ÐºÑ‚ÑÐ±Ñ€ÑŒ_Ð½Ð¾ÑÐ±Ñ€ÑŒ_Ð´ÐµÐºÐ°Ð±Ñ€ÑŒ".split("_"),monthsShort:"ÑÐ½Ð²_Ñ„ÐµÐ²_Ð¼Ð°Ñ€_Ð°Ð¿Ñ€_Ð¼Ð°Ð¹_Ð¸ÑŽÐ½_Ð¸ÑŽÐ»_Ð°Ð²Ð³_ÑÐµÐ½_Ð¾ÐºÑ‚_Ð½Ð¾Ñ_Ð´ÐµÐº".split("_"),weekdays:"Ð¯ÐºÑˆÐ°Ð½Ð±Ð°_Ð”ÑƒÑˆÐ°Ð½Ð±Ð°_Ð¡ÐµÑˆÐ°Ð½Ð±Ð°_Ð§Ð¾Ñ€ÑˆÐ°Ð½Ð±Ð°_ÐŸÐ°Ð¹ÑˆÐ°Ð½Ð±Ð°_Ð–ÑƒÐ¼Ð°_Ð¨Ð°Ð½Ð±Ð°".split("_"),weekdaysShort:"Ð¯ÐºÑˆ_Ð”ÑƒÑˆ_Ð¡ÐµÑˆ_Ð§Ð¾Ñ€_ÐŸÐ°Ð¹_Ð–ÑƒÐ¼_Ð¨Ð°Ð½".split("_"),weekdaysMin:"Ð¯Ðº_Ð”Ñƒ_Ð¡Ðµ_Ð§Ð¾_ÐŸÐ°_Ð–Ñƒ_Ð¨Ð°".split("_"),longDateFormat:{LT:"HH:mm",L:"DD/MM/YYYY",LL:"D MMMM YYYY",LLL:"D MMMM YYYY LT",LLLL:"D MMMM YYYY, dddd LT"},calendar:{sameDay:"[Ð‘ÑƒÐ³ÑƒÐ½ ÑÐ¾Ð°Ñ‚] LT [Ð´Ð°]",nextDay:"[Ð­Ñ€Ñ‚Ð°Ð³Ð°] LT [Ð´Ð°]",nextWeek:"dddd [ÐºÑƒÐ½Ð¸ ÑÐ¾Ð°Ñ‚] LT [Ð´Ð°]",lastDay:"[ÐšÐµÑ‡Ð° ÑÐ¾Ð°Ñ‚] LT [Ð´Ð°]",lastWeek:"[Ð£Ñ‚Ð³Ð°Ð½] dddd [ÐºÑƒÐ½Ð¸ ÑÐ¾Ð°Ñ‚] LT [Ð´Ð°]",sameElse:"L"},relativeTime:{future:"Ð¯ÐºÐ¸Ð½ %s Ð¸Ñ‡Ð¸Ð´Ð°",past:"Ð‘Ð¸Ñ€ Ð½ÐµÑ‡Ð° %s Ð¾Ð»Ð´Ð¸Ð½",s:"Ñ„ÑƒÑ€ÑÐ°Ñ‚",m:"Ð±Ð¸Ñ€ Ð´Ð°ÐºÐ¸ÐºÐ°",mm:"%d Ð´Ð°ÐºÐ¸ÐºÐ°",h:"Ð±Ð¸Ñ€ ÑÐ¾Ð°Ñ‚",hh:"%d ÑÐ¾Ð°Ñ‚",d:"Ð±Ð¸Ñ€ ÐºÑƒÐ½",dd:"%d ÐºÑƒÐ½",M:"Ð±Ð¸Ñ€ Ð¾Ð¹",MM:"%d Ð¾Ð¹",y:"Ð±Ð¸Ñ€ Ð¹Ð¸Ð»",yy:"%d Ð¹Ð¸Ð»"},week:{dow:1,doy:7}})
}),function(a){a(bb)}(function(a){return a.lang("vn",{months:"thÃ¡ng 1_thÃ¡ng 2_thÃ¡ng 3_thÃ¡ng 4_thÃ¡ng 5_thÃ¡ng 6_thÃ¡ng 7_thÃ¡ng 8_thÃ¡ng 9_thÃ¡ng 10_thÃ¡ng 11_thÃ¡ng 12".split("_"),monthsShort:"Th01_Th02_Th03_Th04_Th05_Th06_Th07_Th08_Th09_Th10_Th11_Th12".split("_"),weekdays:"chá»§ nháº­t_thá»© hai_thá»© ba_thá»© tÆ°_thá»© nÄƒm_thá»© sÃ¡u_thá»© báº£y".split("_"),weekdaysShort:"CN_T2_T3_T4_T5_T6_T7".split("_"),weekdaysMin:"CN_T2_T3_T4_T5_T6_T7".split("_"),longDateFormat:{LT:"HH:mm",L:"DD/MM/YYYY",LL:"D MMMM [nÄƒm] YYYY",LLL:"D MMMM [nÄƒm] YYYY LT",LLLL:"dddd, D MMMM [nÄƒm] YYYY LT",l:"DD/M/YYYY",ll:"D MMM YYYY",lll:"D MMM YYYY LT",llll:"ddd, D MMM YYYY LT"},calendar:{sameDay:"[HÃ´m nay lÃºc] LT",nextDay:"[NgÃ y mai lÃºc] LT",nextWeek:"dddd [tuáº§n tá»›i lÃºc] LT",lastDay:"[HÃ´m qua lÃºc] LT",lastWeek:"dddd [tuáº§n rá»“i lÃºc] LT",sameElse:"L"},relativeTime:{future:"%s tá»›i",past:"%s trÆ°á»›c",s:"vÃ i giÃ¢y",m:"má»™t phÃºt",mm:"%d phÃºt",h:"má»™t giá»",hh:"%d giá»",d:"má»™t ngÃ y",dd:"%d ngÃ y",M:"má»™t thÃ¡ng",MM:"%d thÃ¡ng",y:"má»™t nÄƒm",yy:"%d nÄƒm"},ordinal:function(a){return a},week:{dow:1,doy:4}})}),function(a){a(bb)}(function(a){return a.lang("zh-cn",{months:"ä¸€æœˆ_äºŒæœˆ_ä¸‰æœˆ_å››æœˆ_äº”æœˆ_å…­æœˆ_ä¸ƒæœˆ_å…«æœˆ_ä¹æœˆ_åæœˆ_åä¸€æœˆ_åäºŒæœˆ".split("_"),monthsShort:"1æœˆ_2æœˆ_3æœˆ_4æœˆ_5æœˆ_6æœˆ_7æœˆ_8æœˆ_9æœˆ_10æœˆ_11æœˆ_12æœˆ".split("_"),weekdays:"æ˜ŸæœŸæ—¥_æ˜ŸæœŸä¸€_æ˜ŸæœŸäºŒ_æ˜ŸæœŸä¸‰_æ˜ŸæœŸå››_æ˜ŸæœŸäº”_æ˜ŸæœŸå…­".split("_"),weekdaysShort:"å‘¨æ—¥_å‘¨ä¸€_å‘¨äºŒ_å‘¨ä¸‰_å‘¨å››_å‘¨äº”_å‘¨å…­".split("_"),weekdaysMin:"æ—¥_ä¸€_äºŒ_ä¸‰_å››_äº”_å…­".split("_"),longDateFormat:{LT:"Ahç‚¹mm",L:"YYYYå¹´MMMDæ—¥",LL:"YYYYå¹´MMMDæ—¥",LLL:"YYYYå¹´MMMDæ—¥LT",LLLL:"YYYYå¹´MMMDæ—¥ddddLT",l:"YYYYå¹´MMMDæ—¥",ll:"YYYYå¹´MMMDæ—¥",lll:"YYYYå¹´MMMDæ—¥LT",llll:"YYYYå¹´MMMDæ—¥ddddLT"},meridiem:function(a,b){var c=100*a+b;return 600>c?"å‡Œæ™¨":900>c?"æ—©ä¸Š":1130>c?"ä¸Šåˆ":1230>c?"ä¸­åˆ":1800>c?"ä¸‹åˆ":"æ™šä¸Š"},calendar:{sameDay:function(){return 0===this.minutes()?"[ä»Šå¤©]Ah[ç‚¹æ•´]":"[ä»Šå¤©]LT"},nextDay:function(){return 0===this.minutes()?"[æ˜Žå¤©]Ah[ç‚¹æ•´]":"[æ˜Žå¤©]LT"},lastDay:function(){return 0===this.minutes()?"[æ˜¨å¤©]Ah[ç‚¹æ•´]":"[æ˜¨å¤©]LT"},nextWeek:function(){var b,c;return b=a().startOf("week"),c=this.unix()-b.unix()>=604800?"[ä¸‹]":"[æœ¬]",0===this.minutes()?c+"dddAhç‚¹æ•´":c+"dddAhç‚¹mm"},lastWeek:function(){var b,c;return b=a().startOf("week"),c=this.unix()<b.unix()?"[ä¸Š]":"[æœ¬]",0===this.minutes()?c+"dddAhç‚¹æ•´":c+"dddAhç‚¹mm"},sameElse:"L"},ordinal:function(a,b){switch(b){case"d":case"D":case"DDD":return a+"æ—¥";case"M":return a+"æœˆ";case"w":case"W":return a+"å‘¨";default:return a}},relativeTime:{future:"%så†…",past:"%så‰",s:"å‡ ç§’",m:"1åˆ†é’Ÿ",mm:"%dåˆ†é’Ÿ",h:"1å°æ—¶",hh:"%då°æ—¶",d:"1å¤©",dd:"%då¤©",M:"1ä¸ªæœˆ",MM:"%dä¸ªæœˆ",y:"1å¹´",yy:"%då¹´"},week:{dow:1,doy:4}})}),function(a){a(bb)}(function(a){return a.lang("zh-tw",{months:"ä¸€æœˆ_äºŒæœˆ_ä¸‰æœˆ_å››æœˆ_äº”æœˆ_å…­æœˆ_ä¸ƒæœˆ_å…«æœˆ_ä¹æœˆ_åæœˆ_åä¸€æœˆ_åäºŒæœˆ".split("_"),monthsShort:"1æœˆ_2æœˆ_3æœˆ_4æœˆ_5æœˆ_6æœˆ_7æœˆ_8æœˆ_9æœˆ_10æœˆ_11æœˆ_12æœˆ".split("_"),weekdays:"æ˜ŸæœŸæ—¥_æ˜ŸæœŸä¸€_æ˜ŸæœŸäºŒ_æ˜ŸæœŸä¸‰_æ˜ŸæœŸå››_æ˜ŸæœŸäº”_æ˜ŸæœŸå…­".split("_"),weekdaysShort:"é€±æ—¥_é€±ä¸€_é€±äºŒ_é€±ä¸‰_é€±å››_é€±äº”_é€±å…­".split("_"),weekdaysMin:"æ—¥_ä¸€_äºŒ_ä¸‰_å››_äº”_å…­".split("_"),longDateFormat:{LT:"Ahé»žmm",L:"YYYYå¹´MMMDæ—¥",LL:"YYYYå¹´MMMDæ—¥",LLL:"YYYYå¹´MMMDæ—¥LT",LLLL:"YYYYå¹´MMMDæ—¥ddddLT",l:"YYYYå¹´MMMDæ—¥",ll:"YYYYå¹´MMMDæ—¥",lll:"YYYYå¹´MMMDæ—¥LT",llll:"YYYYå¹´MMMDæ—¥ddddLT"},meridiem:function(a,b){var c=100*a+b;return 900>c?"æ—©ä¸Š":1130>c?"ä¸Šåˆ":1230>c?"ä¸­åˆ":1800>c?"ä¸‹åˆ":"æ™šä¸Š"},calendar:{sameDay:"[ä»Šå¤©]LT",nextDay:"[æ˜Žå¤©]LT",nextWeek:"[ä¸‹]ddddLT",lastDay:"[æ˜¨å¤©]LT",lastWeek:"[ä¸Š]ddddLT",sameElse:"L"},ordinal:function(a,b){switch(b){case"d":case"D":case"DDD":return a+"æ—¥";case"M":return a+"æœˆ";case"w":case"W":return a+"é€±";default:return a}},relativeTime:{future:"%så…§",past:"%så‰",s:"å¹¾ç§’",m:"ä¸€åˆ†é˜",mm:"%dåˆ†é˜",h:"ä¸€å°æ™‚",hh:"%då°æ™‚",d:"ä¸€å¤©",dd:"%då¤©",M:"ä¸€å€‹æœˆ",MM:"%då€‹æœˆ",y:"ä¸€å¹´",yy:"%då¹´"}})}),bb.lang("en"),nb?(module.exports=bb,ab(!0)):"function"==typeof define&&define.amd?define("moment",function(b,c,d){return d.config().noGlobal!==!0&&ab(d.config().noGlobal===a),bb}):ab()}).call(this);
/*!
 * numeral.js
 * version : 1.5.2
 * author : Adam Draper
 * license : MIT
 * http://adamwdraper.github.com/Numeral-js/
 */
(function(){function a(a){this._value=a}function b(a,b,c,d){var e,f,g=Math.pow(10,b);return f=(c(a*g)/g).toFixed(b),d&&(e=new RegExp("0{1,"+d+"}$"),f=f.replace(e,"")),f}function c(a,b,c){var d;return d=b.indexOf("$")>-1?e(a,b,c):b.indexOf("%")>-1?f(a,b,c):b.indexOf(":")>-1?g(a,b):i(a._value,b,c)}function d(a,b){var c,d,e,f,g,i=b,j=["KB","MB","GB","TB","PB","EB","ZB","YB"],k=!1;if(b.indexOf(":")>-1)a._value=h(b);else if(b===o)a._value=0;else{for("."!==m[n].delimiters.decimal&&(b=b.replace(/\./g,"").replace(m[n].delimiters.decimal,".")),c=new RegExp("[^a-zA-Z]"+m[n].abbreviations.thousand+"(?:\\)|(\\"+m[n].currency.symbol+")?(?:\\))?)?$"),d=new RegExp("[^a-zA-Z]"+m[n].abbreviations.million+"(?:\\)|(\\"+m[n].currency.symbol+")?(?:\\))?)?$"),e=new RegExp("[^a-zA-Z]"+m[n].abbreviations.billion+"(?:\\)|(\\"+m[n].currency.symbol+")?(?:\\))?)?$"),f=new RegExp("[^a-zA-Z]"+m[n].abbreviations.trillion+"(?:\\)|(\\"+m[n].currency.symbol+")?(?:\\))?)?$"),g=0;g<=j.length&&!(k=b.indexOf(j[g])>-1?Math.pow(1024,g+1):!1);g++);a._value=(k?k:1)*(i.match(c)?Math.pow(10,3):1)*(i.match(d)?Math.pow(10,6):1)*(i.match(e)?Math.pow(10,9):1)*(i.match(f)?Math.pow(10,12):1)*(b.indexOf("%")>-1?.01:1)*((b.split("-").length+Math.min(b.split("(").length-1,b.split(")").length-1))%2?1:-1)*Number(b.replace(/[^0-9\.]+/g,"")),a._value=k?Math.ceil(a._value):a._value}return a._value}function e(a,b,c){var d,e=b.indexOf("$")<=1?!0:!1,f="";return b.indexOf(" $")>-1?(f=" ",b=b.replace(" $","")):b.indexOf("$ ")>-1?(f=" ",b=b.replace("$ ","")):b=b.replace("$",""),d=i(a._value,b,c),e?d.indexOf("(")>-1||d.indexOf("-")>-1?(d=d.split(""),d.splice(1,0,m[n].currency.symbol+f),d=d.join("")):d=m[n].currency.symbol+f+d:d.indexOf(")")>-1?(d=d.split(""),d.splice(-1,0,f+m[n].currency.symbol),d=d.join("")):d=d+f+m[n].currency.symbol,d}function f(a,b,c){var d,e="",f=100*a._value;return b.indexOf(" %")>-1?(e=" ",b=b.replace(" %","")):b=b.replace("%",""),d=i(f,b,c),d.indexOf(")")>-1?(d=d.split(""),d.splice(-1,0,e+"%"),d=d.join("")):d=d+e+"%",d}function g(a){var b=Math.floor(a._value/60/60),c=Math.floor((a._value-60*60*b)/60),d=Math.round(a._value-60*60*b-60*c);return b+":"+(10>c?"0"+c:c)+":"+(10>d?"0"+d:d)}function h(a){var b=a.split(":"),c=0;return 3===b.length?(c+=60*60*Number(b[0]),c+=60*Number(b[1]),c+=Number(b[2])):2===b.length&&(c+=60*Number(b[0]),c+=Number(b[1])),Number(c)}function i(a,c,d){var e,f,g,h,i,j,k=!1,l=!1,p=!1,q="",r="",s="",t=Math.abs(a),u=["B","KB","MB","GB","TB","PB","EB","ZB","YB"],v="",w=!1;if(0===a&&null!==o)return o;if(c.indexOf("(")>-1?(k=!0,c=c.slice(1,-1)):c.indexOf("+")>-1&&(l=!0,c=c.replace(/\+/g,"")),c.indexOf("a")>-1&&(c.indexOf(" a")>-1?(q=" ",c=c.replace(" a","")):c=c.replace("a",""),t>=Math.pow(10,12)?(q+=m[n].abbreviations.trillion,a/=Math.pow(10,12)):t<Math.pow(10,12)&&t>=Math.pow(10,9)?(q+=m[n].abbreviations.billion,a/=Math.pow(10,9)):t<Math.pow(10,9)&&t>=Math.pow(10,6)?(q+=m[n].abbreviations.million,a/=Math.pow(10,6)):t<Math.pow(10,6)&&t>=Math.pow(10,3)&&(q+=m[n].abbreviations.thousand,a/=Math.pow(10,3))),c.indexOf("b")>-1)for(c.indexOf(" b")>-1?(r=" ",c=c.replace(" b","")):c=c.replace("b",""),g=0;g<=u.length;g++)if(e=Math.pow(1024,g),f=Math.pow(1024,g+1),a>=e&&f>a){r+=u[g],e>0&&(a/=e);break}return c.indexOf("o")>-1&&(c.indexOf(" o")>-1?(s=" ",c=c.replace(" o","")):c=c.replace("o",""),s+=m[n].ordinal(a)),c.indexOf("[.]")>-1&&(p=!0,c=c.replace("[.]",".")),h=a.toString().split(".")[0],i=c.split(".")[1],j=c.indexOf(","),i?(i.indexOf("[")>-1?(i=i.replace("]",""),i=i.split("["),v=b(a,i[0].length+i[1].length,d,i[1].length)):v=b(a,i.length,d),h=v.split(".")[0],v=v.split(".")[1].length?m[n].delimiters.decimal+v.split(".")[1]:"",p&&0===Number(v.slice(1))&&(v="")):h=b(a,null,d),h.indexOf("-")>-1&&(h=h.slice(1),w=!0),j>-1&&(h=h.toString().replace(/(\d)(?=(\d{3})+(?!\d))/g,"$1"+m[n].delimiters.thousands)),0===c.indexOf(".")&&(h=""),(k&&w?"(":"")+(!k&&w?"-":"")+(!w&&l?"+":"")+h+v+(s?s:"")+(q?q:"")+(r?r:"")+(k&&w?")":"")}function j(a,b){m[a]=b}var k,l="1.5.2",m={},n="en",o=null,p="0,0",q="undefined"!=typeof module&&module.exports;k=function(b){return k.isNumeral(b)?b=b.value():0===b||"undefined"==typeof b?b=0:Number(b)||(b=k.fn.unformat(b)),new a(Number(b))},k.version=l,k.isNumeral=function(b){return b instanceof a},k.language=function(a,b){if(!a)return n;if(a&&!b){if(!m[a])throw new Error("Unknown language : "+a);n=a}return(b||!m[a])&&j(a,b),k},k.languageData=function(a){if(!a)return m[n];if(!m[a])throw new Error("Unknown language : "+a);return m[a]},k.language("en",{delimiters:{thousands:",",decimal:"."},abbreviations:{thousand:"k",million:"m",billion:"b",trillion:"t"},ordinal:function(a){var b=a%10;return 1===~~(a%100/10)?"th":1===b?"st":2===b?"nd":3===b?"rd":"th"},currency:{symbol:"$"}}),k.zeroFormat=function(a){o="string"==typeof a?a:null},k.defaultFormat=function(a){p="string"==typeof a?a:"0.0"},k.fn=a.prototype={clone:function(){return k(this)},format:function(a,b){return c(this,a?a:p,void 0!==b?b:Math.round)},unformat:function(a){return"[object Number]"===Object.prototype.toString.call(a)?a:d(this,a?a:p)},value:function(){return this._value},valueOf:function(){return this._value},set:function(a){return this._value=Number(a),this},add:function(a){return this._value=this._value+Number(a),this},subtract:function(a){return this._value=this._value-Number(a),this},multiply:function(a){return this._value=this._value*Number(a),this},divide:function(a){return this._value=this._value/Number(a),this},difference:function(a){var b=this._value-Number(a);return 0>b&&(b=-b),b}},q&&(module.exports=k),"undefined"==typeof ender&&(this.numeral=k),"function"==typeof define&&define.amd&&define([],function(){return k})}).call(this);/*! 
 * numeral.js language configuration
 * language : belgium-dutch (be-nl)
 * author : Dieter Luypaert : https://github.com/moeriki
 */
!function(){var a={delimiters:{thousands:" ",decimal:","},abbreviations:{thousand:"k",million:" mln",billion:" mld",trillion:" bln"},ordinal:function(a){var b=a%100;return 0!==a&&1>=b||8===b||b>=20?"ste":"de"},currency:{symbol:"€ "}};"undefined"!=typeof module&&module.exports&&(module.exports=a),"undefined"!=typeof window&&this.numeral&&this.numeral.language&&this.numeral.language("be-nl",a)}(),/*!
 * numeral.js language configuration
 * language : czech (cs)
 * author : Anatoli Papirovski : https://github.com/apapirovski
 */
function(){var a={delimiters:{thousands:" ",decimal:","},abbreviations:{thousand:"tis.",million:"mil.",billion:"b",trillion:"t"},ordinal:function(){return"."},currency:{symbol:"Kč"}};"undefined"!=typeof module&&module.exports&&(module.exports=a),"undefined"!=typeof window&&this.numeral&&this.numeral.language&&this.numeral.language("cs",a)}(),/*! 
 * numeral.js language configuration
 * language : danish denmark (dk)
 * author : Michael Storgaard : https://github.com/mstorgaard
 */
function(){var a={delimiters:{thousands:".",decimal:","},abbreviations:{thousand:"k",million:"mio",billion:"mia",trillion:"b"},ordinal:function(){return"."},currency:{symbol:"DKK"}};"undefined"!=typeof module&&module.exports&&(module.exports=a),"undefined"!=typeof window&&this.numeral&&this.numeral.language&&this.numeral.language("da-dk",a)}(),/*! 
 * numeral.js language configuration
 * language : German in Switzerland (de-ch)
 * author : Michael Piefel : https://github.com/piefel (based on work from Marco Krage : https://github.com/sinky)
 */
function(){var a={delimiters:{thousands:" ",decimal:","},abbreviations:{thousand:"k",million:"m",billion:"b",trillion:"t"},ordinal:function(){return"."},currency:{symbol:"CHF"}};"undefined"!=typeof module&&module.exports&&(module.exports=a),"undefined"!=typeof window&&this.numeral&&this.numeral.language&&this.numeral.language("de-ch",a)}(),/*! 
 * numeral.js language configuration
 * language : German (de) – generally useful in Germany, Austria, Luxembourg, Belgium
 * author : Marco Krage : https://github.com/sinky
 */
function(){var a={delimiters:{thousands:" ",decimal:","},abbreviations:{thousand:"k",million:"m",billion:"b",trillion:"t"},ordinal:function(){return"."},currency:{symbol:"€"}};"undefined"!=typeof module&&module.exports&&(module.exports=a),"undefined"!=typeof window&&this.numeral&&this.numeral.language&&this.numeral.language("de",a)}(),/*! 
 * numeral.js language configuration
 * language : english united kingdom (uk)
 * author : Dan Ristic : https://github.com/dristic
 */
function(){var a={delimiters:{thousands:",",decimal:"."},abbreviations:{thousand:"k",million:"m",billion:"b",trillion:"t"},ordinal:function(a){var b=a%10;return 1===~~(a%100/10)?"th":1===b?"st":2===b?"nd":3===b?"rd":"th"},currency:{symbol:"£"}};"undefined"!=typeof module&&module.exports&&(module.exports=a),"undefined"!=typeof window&&this.numeral&&this.numeral.language&&this.numeral.language("en-gb",a)}(),/*! 
 * numeral.js language configuration
 * language : spanish Spain
 * author : Hernan Garcia : https://github.com/hgarcia
 */
function(){var a={delimiters:{thousands:".",decimal:","},abbreviations:{thousand:"k",million:"mm",billion:"b",trillion:"t"},ordinal:function(a){var b=a%10;return 1===b||3===b?"er":2===b?"do":7===b||0===b?"mo":8===b?"vo":9===b?"no":"to"},currency:{symbol:"€"}};"undefined"!=typeof module&&module.exports&&(module.exports=a),"undefined"!=typeof window&&this.numeral&&this.numeral.language&&this.numeral.language("es",a)}(),/*! 
 * numeral.js language configuration
 * language : spanish
 * author : Hernan Garcia : https://github.com/hgarcia
 */
function(){var a={delimiters:{thousands:".",decimal:","},abbreviations:{thousand:"k",million:"mm",billion:"b",trillion:"t"},ordinal:function(a){var b=a%10;return 1===b||3===b?"er":2===b?"do":7===b||0===b?"mo":8===b?"vo":9===b?"no":"to"},currency:{symbol:"$"}};"undefined"!=typeof module&&module.exports&&(module.exports=a),"undefined"!=typeof window&&this.numeral&&this.numeral.language&&this.numeral.language("es",a)}(),/*! 
 * numeral.js language configuration
 * language : Finnish
 * author : Sami Saada : https://github.com/samitheberber
 */
function(){var a={delimiters:{thousands:" ",decimal:","},abbreviations:{thousand:"k",million:"M",billion:"G",trillion:"T"},ordinal:function(){return"."},currency:{symbol:"€"}};"undefined"!=typeof module&&module.exports&&(module.exports=a),"undefined"!=typeof window&&this.numeral&&this.numeral.language&&this.numeral.language("fi",a)}(),/*!
 * numeral.js language configuration
 * language : french (Canada) (fr-CA)
 * author : Léo Renaud-Allaire : https://github.com/renaudleo
 */
function(){var a={delimiters:{thousands:" ",decimal:","},abbreviations:{thousand:"k",million:"M",billion:"G",trillion:"T"},ordinal:function(a){return 1===a?"er":"e"},currency:{symbol:"$"}};"undefined"!=typeof module&&module.exports&&(module.exports=a),"undefined"!=typeof window&&this.numeral&&this.numeral.language&&this.numeral.language("fr-CA",a)}(),/*! 
 * numeral.js language configuration
 * language : french (fr-ch)
 * author : Adam Draper : https://github.com/adamwdraper
 */
function(){var a={delimiters:{thousands:"'",decimal:"."},abbreviations:{thousand:"k",million:"m",billion:"b",trillion:"t"},ordinal:function(a){return 1===a?"er":"e"},currency:{symbol:"CHF"}};"undefined"!=typeof module&&module.exports&&(module.exports=a),"undefined"!=typeof window&&this.numeral&&this.numeral.language&&this.numeral.language("fr-ch",a)}(),/*! 
 * numeral.js language configuration
 * language : french (fr)
 * author : Adam Draper : https://github.com/adamwdraper
 */
function(){var a={delimiters:{thousands:" ",decimal:","},abbreviations:{thousand:"k",million:"m",billion:"b",trillion:"t"},ordinal:function(a){return 1===a?"er":"e"},currency:{symbol:"€"}};"undefined"!=typeof module&&module.exports&&(module.exports=a),"undefined"!=typeof window&&this.numeral&&this.numeral.language&&this.numeral.language("fr",a)}(),/*!
 * numeral.js language configuration
 * language : Hungarian (hu)
 * author : Peter Bakondy : https://github.com/pbakondy
 */
function(){var a={delimiters:{thousands:" ",decimal:","},abbreviations:{thousand:"E",million:"M",billion:"Mrd",trillion:"T"},ordinal:function(){return"."},currency:{symbol:" Ft"}};"undefined"!=typeof module&&module.exports&&(module.exports=a),"undefined"!=typeof window&&this.numeral&&this.numeral.language&&this.numeral.language("hu",a)}(),/*! 
 * numeral.js language configuration
 * language : italian Italy (it)
 * author : Giacomo Trombi : http://cinquepunti.it
 */
function(){var a={delimiters:{thousands:".",decimal:","},abbreviations:{thousand:"mila",million:"mil",billion:"b",trillion:"t"},ordinal:function(){return"º"},currency:{symbol:"€"}};"undefined"!=typeof module&&module.exports&&(module.exports=a),"undefined"!=typeof window&&this.numeral&&this.numeral.language&&this.numeral.language("it",a)}(),/*! 
 * numeral.js language configuration
 * language : japanese
 * author : teppeis : https://github.com/teppeis
 */
function(){var a={delimiters:{thousands:",",decimal:"."},abbreviations:{thousand:"千",million:"百万",billion:"十億",trillion:"兆"},ordinal:function(){return"."},currency:{symbol:"¥"}};"undefined"!=typeof module&&module.exports&&(module.exports=a),"undefined"!=typeof window&&this.numeral&&this.numeral.language&&this.numeral.language("ja",a)}(),/*! 
 * numeral.js language configuration
 * language : netherlands-dutch (nl-nl)
 * author : Dave Clayton : https://github.com/davedx
 */
function(){var a={delimiters:{thousands:".",decimal:","},abbreviations:{thousand:"k",million:"mln",billion:"mrd",trillion:"bln"},ordinal:function(a){var b=a%100;return 0!==a&&1>=b||8===b||b>=20?"ste":"de"},currency:{symbol:"€ "}};"undefined"!=typeof module&&module.exports&&(module.exports=a),"undefined"!=typeof window&&this.numeral&&this.numeral.language&&this.numeral.language("nl-nl",a)}(),/*! 
 * numeral.js language configuration
 * language : netherlands-dutch (nl)
 * author : Dave Clayton : https://github.com/davedx
 */
function(){var a={delimiters:{thousands:".",decimal:","},abbreviations:{thousand:"k",million:"mln",billion:"mrd",trillion:"bln"},ordinal:function(a){var b=a%100;return 0!==a&&1>=b||8===b||b>=20?"ste":"de"},currency:{symbol:"€ "}};"undefined"!=typeof module&&module.exports&&(module.exports=a),"undefined"!=typeof window&&this.numeral&&this.numeral.language&&this.numeral.language("nl",a)}(),/*! 
 * numeral.js language configuration
 * language : polish (pl)
 * author : Dominik Bulaj : https://github.com/dominikbulaj
 */
function(){var a={delimiters:{thousands:" ",decimal:","},abbreviations:{thousand:"tys.",million:"mln",billion:"mld",trillion:"bln"},ordinal:function(){return"."},currency:{symbol:"PLN"}};"undefined"!=typeof module&&module.exports&&(module.exports=a),"undefined"!=typeof window&&this.numeral&&this.numeral.language&&this.numeral.language("pl",a)}(),/*! 
 * numeral.js language configuration
 * language : portuguese brazil (pt-br)
 * author : Ramiro Varandas Jr : https://github.com/ramirovjr
 */
function(){var a={delimiters:{thousands:".",decimal:","},abbreviations:{thousand:"mil",million:"milhões",billion:"b",trillion:"t"},ordinal:function(){return"º"},currency:{symbol:"R$"}};"undefined"!=typeof module&&module.exports&&(module.exports=a),"undefined"!=typeof window&&this.numeral&&this.numeral.language&&this.numeral.language("pt-br",a)}(),/*! 
 * numeral.js language configuration
 * language : portuguese (pt-pt)
 * author : Diogo Resende : https://github.com/dresende
 */
function(){var a={delimiters:{thousands:" ",decimal:","},abbreviations:{thousand:"k",million:"m",billion:"b",trillion:"t"},ordinal:function(){return"º"},currency:{symbol:"€"}};"undefined"!=typeof module&&module.exports&&(module.exports=a),"undefined"!=typeof window&&this.numeral&&this.numeral.language&&this.numeral.language("pt-pt",a)}(),function(){var a={delimiters:{thousands:" ",decimal:","},abbreviations:{thousand:"тыс.",million:"млн",billion:"b",trillion:"t"},ordinal:function(){return"."},currency:{symbol:"₴"}};"undefined"!=typeof module&&module.exports&&(module.exports=a),"undefined"!=typeof window&&this.numeral&&this.numeral.language&&this.numeral.language("ru-UA",a)}(),/*! 
 * numeral.js language configuration
 * language : russian (ru)
 * author : Anatoli Papirovski : https://github.com/apapirovski
 */
function(){var a={delimiters:{thousands:" ",decimal:","},abbreviations:{thousand:"тыс.",million:"млн",billion:"b",trillion:"t"},ordinal:function(){return"."},currency:{symbol:"руб."}};"undefined"!=typeof module&&module.exports&&(module.exports=a),"undefined"!=typeof window&&this.numeral&&this.numeral.language&&this.numeral.language("ru",a)}(),/*!
 * numeral.js language configuration
 * language : slovak (sk)
 * author : Ahmed Al Hafoudh : http://www.freevision.sk
 */
function(){var a={delimiters:{thousands:" ",decimal:","},abbreviations:{thousand:"tis.",million:"mil.",billion:"b",trillion:"t"},ordinal:function(){return"."},currency:{symbol:"€"}};"undefined"!=typeof module&&module.exports&&(module.exports=a),"undefined"!=typeof window&&this.numeral&&this.numeral.language&&this.numeral.language("sk",a)}(),/*! 
 * numeral.js language configuration
 * language : thai (th)
 * author : Sathit Jittanupat : https://github.com/jojosati
 */
function(){var a={delimiters:{thousands:",",decimal:"."},abbreviations:{thousand:"พัน",million:"ล้าน",billion:"พันล้าน",trillion:"ล้านล้าน"},ordinal:function(){return"."},currency:{symbol:"฿"}};"undefined"!=typeof module&&module.exports&&(module.exports=a),"undefined"!=typeof window&&this.numeral&&this.numeral.language&&this.numeral.language("th",a)}(),/*! 
 * numeral.js language configuration
 * language : turkish (tr)
 * author : Ecmel Ercan : https://github.com/ecmel, Erhan Gundogan : https://github.com/erhangundogan, Burak Yiğit Kaya: https://github.com/BYK
 */
function(){var a={1:"'inci",5:"'inci",8:"'inci",70:"'inci",80:"'inci",2:"'nci",7:"'nci",20:"'nci",50:"'nci",3:"'üncü",4:"'üncü",100:"'üncü",6:"'ncı",9:"'uncu",10:"'uncu",30:"'uncu",60:"'ıncı",90:"'ıncı"},b={delimiters:{thousands:".",decimal:","},abbreviations:{thousand:"bin",million:"milyon",billion:"milyar",trillion:"trilyon"},ordinal:function(b){if(0===b)return"'ıncı";var c=b%10,d=b%100-c,e=b>=100?100:null;return a[c]||a[d]||a[e]},currency:{symbol:"₺"}};"undefined"!=typeof module&&module.exports&&(module.exports=b),"undefined"!=typeof window&&this.numeral&&this.numeral.language&&this.numeral.language("tr",b)}(),function(){var a={delimiters:{thousands:" ",decimal:","},abbreviations:{thousand:"тис.",million:"млн",billion:"млрд",trillion:"блн"},ordinal:function(){return""},currency:{symbol:"₴"}};"undefined"!=typeof module&&module.exports&&(module.exports=a),"undefined"!=typeof window&&this.numeral&&this.numeral.language&&this.numeral.language("uk-UA",a)}();
/*jslint browser: true, nomen: true, vars: true, white: true, forin: true */

(function (crafity) {
	"use strict";

	crafity.region = "nl";

	(function (core) {

		core.mixin = function mixin(target, Type) {
			var instance = new Type();
			var prop;

			for (prop in instance) {
				target[prop] = instance[prop];
			}
			target.prototype = instance;
			target.prototype.constructor = Type;
			return target;
		};

		core.hasTouch = function () {
			return ('ontouchstart' in window) || (window.DocumentTouch && document instanceof DocumentTouch);
		};

		core.events = {
			click: core.hasTouch() ? 'touchstart' : 'click',
			mouseup: core.hasTouch() ? 'touchend' : 'mouseup',
			mousemove: core.hasTouch() ? 'touchmove' : 'mousemove'
		};
	}(crafity.core = crafity.core || {}));

}(window.crafity = window.crafity || {}));
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

// Namespace:  window.crafity.core.EventEmitter
(function (crafity, undefined) {

	(function (exports) {

		var isArray = Array.isArray;
		var domain;

		function EventEmitter() {
			if (exports.usingDomains) {
				// if there is an active domain, then attach to it.
				domain = domain || require('domain');
				if (domain.active && !(this instanceof domain.Domain)) {
					this.domain = domain.active;
				}
			}
		}

		exports.EventEmitter = EventEmitter;

		// By default EventEmitters will print a warning if more than
		// 10 listeners are added to it. This is a useful default which
		// helps finding memory leaks.
		//
		// Obviously not all Emitters should be limited to 10. This function allows
		// that to be increased. Set to zero for unlimited.
		var defaultMaxListeners = 10;
		EventEmitter.prototype.setMaxListeners = function (n) {
			if (!this._events) this._events = {};
			this._maxListeners = n;
		};

		EventEmitter.prototype.emit = function () {
			var type = arguments[0];
			// If there is no 'error' event listener then throw.
			if (type === 'error') {
				if (!this._events || !this._events.error ||
					(isArray(this._events.error) && !this._events.error.length)) {
					if (this.domain) {
						var er = arguments[1];
						er.domain_emitter = this;
						er.domain = this.domain;
						er.domain_thrown = false;
						this.domain.emit('error', er);
						return false;
					}

					if (arguments[1] instanceof Error) {
						throw arguments[1]; // Unhandled 'error' event
					} else {
						throw new Error("Uncaught, unspecified 'error' event.");
					}
					return false;
				}
			}

			if (!this._events) return false;
			var handler = this._events[type];
			if (!handler) return false;

			if (typeof handler == 'function') {
				if (this.domain) {
					console.log("this.domain", this.domain);
					this.domain.enter();
				}
				switch (arguments.length) {
					// fast cases
					case 1:
						handler.call(this);
						break;
					case 2:
						handler.call(this, arguments[1]);
						break;
					case 3:
						handler.call(this, arguments[1], arguments[2]);
						break;
					// slower
					default:
						var l = arguments.length;
						var args = new Array(l - 1);
						for (var i = 1; i < l; i++) args[i - 1] = arguments[i];
						handler.apply(this, args);
				}
				if (this.domain) {
					this.domain.exit();
				}
				return true;

			} else if (isArray(handler)) {
				if (this.domain) {
					this.domain.enter();
				}
				var l = arguments.length;
				var args = new Array(l - 1);
				for (var i = 1; i < l; i++) args[i - 1] = arguments[i];

				var listeners = handler.slice();
				for (var i = 0, l = listeners.length; i < l; i++) {
					listeners[i].apply(this, args);
				}
				if (this.domain) {
					this.domain.exit();
				}
				return true;

			} else {
				return false;
			}
		};

		EventEmitter.prototype.addListener = function (type, listener) {
			if ('function' !== typeof listener) {
				throw new Error('addListener only takes instances of Function');
			}

			if (!this._events) this._events = {};

			// To avoid recursion in the case that type == "newListeners"! Before
			// adding it to the listeners, first emit "newListeners".
			this.emit('newListener', type, typeof listener.listener === 'function' ?
				listener.listener : listener);

			if (!this._events[type]) {
				// Optimize the case of one listener. Don't need the extra array object.
				this._events[type] = listener;
			} else if (isArray(this._events[type])) {

				// If we've already got an array, just append.
				this._events[type].push(listener);

			} else {
				// Adding the second element, need to change to array.
				this._events[type] = [this._events[type], listener];

			}

			// Check for listener leak
			if (isArray(this._events[type]) && !this._events[type].warned) {
				var m;
				if (this._maxListeners !== undefined) {
					m = this._maxListeners;
				} else {
					m = defaultMaxListeners;
				}

				if (m && m > 0 && this._events[type].length > m) {
					this._events[type].warned = true;
					console.error('(node) warning: possible EventEmitter memory ' +
						'leak detected. %d listeners added. ' +
						'Use emitter.setMaxListeners() to increase limit.',
						this._events[type].length);
					console.trace();
				}
			}

			return this;
		};

		EventEmitter.prototype.on = EventEmitter.prototype.addListener;

		EventEmitter.prototype.once = function (type, listener) {
			if ('function' !== typeof listener) {
				throw new Error('.once only takes instances of Function');
			}

			var self = this;

			function g() {
				self.removeListener(type, g);
				listener.apply(this, arguments);
			};

			g.listener = listener;
			self.on(type, g);

			return this;
		};

		EventEmitter.prototype.removeListener = function (type, listener) {
			if ('function' !== typeof listener) {
				throw new Error('removeListener only takes instances of Function');
			}

			// does not use listeners(), so no side effect of creating _events[type]
			if (!this._events || !this._events[type]) return this;

			var list = this._events[type];

			if (isArray(list)) {
				var position = -1;
				for (var i = 0, length = list.length; i < length; i++) {
					if (list[i] === listener ||
						(list[i].listener && list[i].listener === listener)) {
						position = i;
						break;
					}
				}

				if (position < 0) return this;
				list.splice(position, 1);
				if (list.length == 0)
					delete this._events[type];
			} else if (list === listener ||
				(list.listener && list.listener === listener)) {
				delete this._events[type];
			}

			return this;
		};

		EventEmitter.prototype.removeAllListeners = function (type) {
			if (arguments.length === 0) {
				this._events = {};
				return this;
			}

			// does not use listeners(), so no side effect of creating _events[type]
			if (type && this._events && this._events[type]) this._events[type] = null;
			return this;
		};

		EventEmitter.prototype.listeners = function (type) {
			if (!this._events || !this._events[type]) return [];
			if (!isArray(this._events[type])) {
				return [this._events[type]];
			}
			return this._events[type].slice(0);
		};

	}(crafity.core = crafity.core || {}));

}(window.crafity = window.crafity || {}, window.undefined));
/*jslint browser: true, nomen: true, vars: true, white: true */

(function (crafity) {
	"use strict";

	function cmdOrCrl(e) {
		// (navigator.platform.match(/Mac/) ? e.metaKey : e.ctrlKey
		return ((e.metaKey && !e.ctrlKey) || (!e.metaKey && e.ctrlKey));
	}

	function attach(domElement) {
		var emitter = new crafity.core.EventEmitter();

		domElement.addEventListener("keydown", function (e) {
			if (e.shiftKey && cmdOrCrl(e) && e.which === 77) {
				emitter.emit("cmd+shft+m", "cmd+shft+m", e);
			}
			if (!e.shiftKey && cmdOrCrl(e) && e.which === 69) {
				emitter.emit("cmd+e", "cmd+e", e);
			}
			if (!e.shiftKey && cmdOrCrl(e) && e.which === 76) {
				emitter.emit("cmd+l", "cmd+l", e);
			}
			if (!e.shiftKey && cmdOrCrl(e) && e.which === 70) {
				emitter.emit("cmd+f", "cmd+f", e);
			}
			if (!e.shiftKey && cmdOrCrl(e) && e.which === 78) {
				emitter.emit("cmd+n", "cmd+n", e);
			}
			if (!e.shiftKey && cmdOrCrl(e) && e.altKey && e.which === 192) {
				emitter.emit("cmd+opt+n", "cmd+opt+n", e);
			}
			if (!e.shiftKey && e.keyIdentifier === "U+001B" && e.which === 27) {
				emitter.emit("esc", "esc", e);
			}
			if (!e.shiftKey && e.keyIdentifier === "U+0008" && !e.altKey && !e.metaKey && e.which === 8) {
				emitter.emit("backspace", "backspace", e);
			}
			if (!e.shiftKey && e.keyIdentifier === "Enter" && e.which === 13) {
				emitter.emit("enter", "enter", e);
			}
			if (e.which === 83 && cmdOrCrl(e)) {
				emitter.emit("cmd+s", "cmd+s", e);
			}
			return true;
		});

		return {
			on: function (shortcuts, callback) {
				[].concat(shortcuts).forEach(function (shortcut) {
					emitter.on(shortcut, callback);
				});
			},
			attach: function (element) {
				return attach(element.element && element.element() || element);
			}
		};
	}

	crafity.keyboard = attach(window);

}(window.crafity = window.crafity || {}));
/*jslint browser: true, nomen: true, vars: true, white: true */
/*globals Window*/

(function (crafity) {
	"use strict";

	(function (html) {

		function Element(type) {
			if (!type) {
				throw new Error("Argument 'type' is required");
			}
			if (!this || this instanceof Window) {
				return new Element(type);
			}
			if (typeof type === "string") {
				//this._element = null;
				this._type = type;
			} else {
				this._type = type.tagName;
				this._element = type;
			}
		}

		Element.prototype = crafity.core.EventEmitter.prototype;
		Element.prototype.children = function (children) {
			if (children === undefined) {
				return this._children = this._children || [];
			}
			if (this._children) {
				this._children = children;
			}
			return this;
		};
		Element.prototype.clear = function () {
			var self = this;
			var children = this.children();
			if (!children.length) {
				return self;
			}
			children.forEach(function (child) {
				self.element().removeChild(child.element());
			});
			this.children([]);
			return this;
		};
		Element.prototype.render = function () {
			return this.element();
		};
		Element.prototype.getType = function () {
			return this._type;
		};
		Element.prototype.data = function (data) {
			if (data === undefined) {
				return this._data;
			}
			this._data = data;
			this.emit("dataChanged", data);
			return this;
		};		
		Element.prototype.element = function () {
			if (!this._element) {
				this._element = document.createElement(this.getType());
				//this._element.self = this;
			} 
//			else if (this._element.self !== this) {
//				var _element = this._element; //.cloneNode();
//				delete this._element;
//				this._element = _element;
//				this._element.self = this;
//				console.log("Cloning", this._element.self, this);
//			}
			return this._element;
		};
		Element.prototype.prepend = function (children) {
			if (!children) {
				return this;
			}
			var self = this;

			function addChild(child) {
				if (child instanceof Element) {
					self.children([child].concat(self.children()));
					if (self.element().childNodes.length > 0) {
						self.element().insertBefore(child.render(), self.element().childNodes[0]);
					} else {
						self.element().appendChild(child.render());
					}
				} else {
					throw new Error("Unexpected child to append");
				}
			}

			if (children instanceof Array) {
				children.forEach(function (child) {
					addChild(child);
				});
			} else if (children instanceof Element) {
				addChild(children);
			} else {
				throw new Error("Unexpected child to append");
			}

			return this;
		};
		Element.prototype.append = function (children) {
			if (!children) {
				return this;
			}
			var self = this;

			function addChild(child) {
				if (child instanceof Element) {
					self.children().push(child);
					self.element().appendChild(child.render());
				} else {
					throw new Error("Unexpected child to append");
				}
			}

			if (children instanceof Array) {
				children.forEach(addChild);
			} else if (children instanceof Element) {
				addChild(children);
			} else {
				throw new Error("Unexpected child to append");
			}

			return this;
		};
		Element.prototype.appendTo = function (parent) {
			if (!parent) {
				return this;
			}
			parent.append(this);
			return this;
		};
		Element.prototype.addClass = function (classNames) {
			var classString = this.element().getAttribute("class");
			var classes = (classString && classString.length && classString.split(" ")) || [];
			var classesToAdd = classNames.split(" ");
			classesToAdd.forEach(function (classToAdd) {
				if (classes.indexOf(classToAdd) > -1) {
					return;
				}
				classes.push(classToAdd);
			});
			this.element().setAttribute("class", classes.join(" "));
			return this;
		};
		Element.prototype.attr = function (name, value) {
			if (value === undefined) {
				return this.element().getAttribute(name);
			}
			if (value === null) {
				this.element().removeAttribute(name);
			} else {
				this.element().setAttribute(name, value);
			}
			return this;
		};
		Element.prototype.hasClass = function (classNames) {
			var classes = (this.element().getAttribute("class") || "").split(" ");
			var classesToCheck = classNames.split(" ");
			if (classesToCheck.length === 0) {
				return false;
			}
			var hasClasses = true;
			classesToCheck.forEach(function (classToAdd) {
				var index = classes.indexOf(classToAdd);
				hasClasses = hasClasses && (index > -1);
			});
			return hasClasses;
		};
		Element.prototype.hasNotClass = function (classNames) {
			return !this.hasClass(classNames);
		};
		Element.prototype.removeClass = function (classNames) {
			var classString = this.element().getAttribute("class");
			var classes = (classString && classString.length && classString.split(" ")) || [];
			var classesToAdd = classNames.split(" ");
			classesToAdd.forEach(function (classToAdd) {
				var index = classes.indexOf(classToAdd);
				if (index === -1) {
					return;
				}
				classes.splice(index, 1);
			});
			this.element().setAttribute("class", classes.join(" "));
			return this;
		};
		Element.prototype.toggleClass = function (classNames) {
			var self = this;
			//var classes = (this.element().getAttribute("class") || "").split(" ");
			var classesToAdd = classNames.split(" ");
			classesToAdd.forEach(function (classToAdd) {
				if (self.hasClass(classToAdd)) {
					self.removeClass(classToAdd);
				} else {
					self.addClass(classToAdd);
				}
			});
			return this;
		};
		Element.prototype.isVisible = function () {
			return this.hasClass("visible") || !this.hasClass("hidden");
		};
		Element.prototype.readonly = function (value) {
			if (value === true) {
				this.addClass("readonly");
				this.attr("readonly", "readonly");
				this.emit("readonlyChanged", value);
			} else if (value === false) {
				this.removeClass("readonly");
				this.attr("readonly", null);
				this.emit("readonlyChanged", value);
			} else {
				return !!this.attr("readonly");
			}
			return this;
		};
		Element.prototype.disabled = function (value) {
			if (value === true) {
				this.attr("disabled", "disabled");
				this.emit("disabledChanged", value);
			} else if (value === false) {
				this.attr("disabled", null);
				this.emit("disabledChanged", value);
			} else {
				return !!this.attr("disabled");
			}
			return this;
		};
		Element.prototype.tabindex = function (value) {
			if (value) {
				this.attr("tabindex", value);
			} else if (value === null) {
				this.attr("tabindex", null);
			} else {
				return !!this.attr("tabindex");
			}
			return this;
		};
		Element.prototype.show = function () {
			this.removeClass("hidden");
			return this;
		};
		Element.prototype.hide = function () {
			this.addClass("hidden");
			return this;
		};
		Element.prototype.text = function (text) {
			if (text) {
				this.element().textContent = text;
				return this;
			}
			return this.element().textContent;
		};
		Element.prototype.html = function (html) {
			if (html) {
				this.element().innerHTML = html;
				return this;
			}
			return this.element().innerHTML;
		};
		Element.prototype.value = function (value) {
			if (value !== undefined) {
				this.element().value = value;
				return this;
			}
			return this.element().value;
		};
		Element.prototype.change = function (callback) {
			var self = this;
			if (callback === undefined) {
				throw new Error("Argument 'callback' is required");
			} else if (callback === null && this.addEventListener.change) {
				self.addEventListener.change.forEach(function (cb) {
					self.removeEventListener("change", cb);
				});
				self.addEventListener.change = [];
			} else if (typeof callback === 'function') {
				self.addEventListener("change", function () {
					callback(self.value());
				});
				if (!self.addEventListener.change) {
					self.addEventListener.change = [];
				}
				self.addEventListener.change.push(callback);
			}
			return self;
		};
		Element.prototype.focus = function (callback) {
			var self = this;
			if (callback === undefined) {
				self.element().focus();
				if (self.addEventListener.focus) {
					self.addEventListener.focus.forEach(function (cb) {
						cb.call(self);
					});
				}
			} else if (callback === null && this.addEventListener.focus) {
				self.addEventListener.focus.forEach(function (cb) {
					self.removeEventListener("focus", cb);
				});
				self.addEventListener.focus = [];
			} else if (typeof callback === 'function') {
				self.addEventListener("focus", callback);
				if (!self.addEventListener.focus) {
					self.addEventListener.focus = [];
				}
				self.addEventListener.focus.push(callback);
			}
			return self;
		};
		Element.prototype.blur = function (callback) {
			var self = this;
			if (callback === undefined) {
				throw new Error("Argument 'callback' is required");
			} else if (callback === null && this.addEventListener.blur) {
				self.addEventListener.blur.forEach(function (cb) {
					self.removeEventListener("blur", cb);
				});
				self.addEventListener.blur = [];
			} else if (typeof callback === 'function') {
				self.addEventListener("blur", callback);
				if (!self.addEventListener.blur) {
					self.addEventListener.blur = [];
				}
				self.addEventListener.blur.push(callback);
			}
			return self;
		};

		Element.prototype.id = function (id) {
			if (id) {
				this.element().setAttribute("id", id);
				return this;
			}
			return this.getAttribute("id");
		};
		Element.prototype.toggleVisibility = function () {
			if (this.isVisible()) {
				this.hide();
			} else {
				this.show();
			}
		};
		Element.prototype.addEventListener = function () {
			this.element().addEventListener.apply(this.element(), arguments);
			return this;
		};
		Element.prototype.removeEventListener = function () {
			this.element().removeEventListener.apply(this.element(), arguments);
			return this;
		};
		html.Element = Element;

	}(crafity.html = crafity.html || {}));

}(window.crafity = window.crafity || {}));
		
/*jslint browser: true, nomen: true, vars: true, white: true */

(function (crafity) {
	"use strict";

	(function (html) {

		function Menu() {
			this.addClass("main menu");
		}

		Menu.prototype = new crafity.html.Element("div");
		Menu.prototype.addMenuPanel = function (menuPanel) {
			var self = this;
			this.append(menuPanel);
			menuPanel.on("selected", function (name, menuPanel, menuItem) {
				self.children().forEach(function (mp) {
					if (mp !== menuPanel) {
						mp.deselectAll();
					}
				});
				self.emit("selected " + name, menuPanel, menuItem);
				self.emit("selected", name, menuPanel, menuItem);
			});
			return self;
		};
		Menu.prototype.addMenuPanels = function (menuPanels) {
			var self = this;
			if (menuPanels instanceof Array) {
				menuPanels.forEach(function (menuPanel) {
					self.addMenuPanel(menuPanel);
				});
			}
			if (menuPanels instanceof html.Element) {
				self.addMenuPanel(menuPanel);
			}
			return self;
		};

		html.Menu = Menu;

		function MenuPanel(name) {
			this.name = name;
			this._menuItems = new html.Element("ul");
			this.addClass("menu-panel hidden");
			if (name) {
				this.append(new html.Element("h2").text(name));
			}
			this.append(this._menuItems);
		}

		MenuPanel.prototype = new html.Element("div");
		MenuPanel.prototype.deselectAll = function () {
			this._menuItems.children().forEach(function (mi) {
				mi.removeClass("selected");
			});
		};
		MenuPanel.prototype.addMenuItem = function (menuItem) {
			var self = this;
			this._menuItems.append(menuItem);
			menuItem.on("click", function () {
				self._menuItems.children().forEach(function (mi) {
					if (mi !== menuItem) {
						mi.removeClass("selected");
					}
				});
				menuItem.addClass("selected");
				self.emit("selected " + self.name + " " + menuItem.name, self, menuItem);
				self.emit("selected", self.name + " " + menuItem.name, self, menuItem);
			});
			return self;
		};
		MenuPanel.prototype.addMenuItems = function (menuItems) {
			var self = this;
			if (menuItems instanceof Array) {
				menuItems.forEach(function (menuItem) {
					self.addMenuItem(menuItem);
				});
			}
			if (menuItems instanceof html.Element) {
				self.addMenuItem(menuItems);
			}
			return self;
		};
		html.MenuPanel = MenuPanel;

		function MenuItem(name, callback) {
			var self = this;

			callback && self.on("click", callback);

			var anchor = new html.Element("a");
			anchor.attr("href", "#" + name);
			anchor.addEventListener(crafity.core.events.click, function (e) {
				if (!self.disabled()) { 
					self.emit("click");
				}
				e.preventDefault();
				return false; 
			});
			this.on("selected", function () {
				self.emit("click", self);
			});
			anchor.text(name);
			this.addClass("menuitem");
			this.name = name;
			this.append(anchor);
		}

		MenuItem.prototype = new html.Element("li");
		MenuItem.prototype.select = function () {
			var self = this;
			self.addClass("selected");
			setTimeout(function () {
				self.emit("selectionChanged", self);
				self.emit("selected", self);
				self.emit("click", self);
			}, 0);
			return this;
		};
		MenuItem.prototype.selected = function () {
			return this.hasClass("selected");
		};
		MenuItem.prototype.deselect = function () {
			this.removeClass("selected");
			this.emit("selectionChanged", this);
			this.emit("deselected", this);
			return this;
		};
		html.MenuItem = MenuItem;

	}(crafity.html = crafity.html || {}));

}(window.crafity = window.crafity || {}));
		
/*jslint browser: true, nomen: true, vars: true, white: true*/

(function (crafity) {
	"use strict";

	(function (html) {

		function PasswordField() {
			var self = this;
			crafity.core.mixin(this, html.Field);

			this.addClass("passwordfield edit");
			this._PasswordField = this._control = new html.Element("input").attr("type", "password");
			this.append(this._PasswordField);
			this.value = function (value) {
				if (value === undefined) {
					return this._PasswordField.value();
				}
				this._PasswordField.value(value);
				return this;

			};

			this.on("readonlyChanged", function (bool) {
				if (bool === true) {
					self.removeClass("edit").addClass("readonly")
						._PasswordField.readonly(true).tabindex("-1");
				}
				if (bool === false) {
					self.addClass("edit").removeClass("readonly")
						._PasswordField.readonly(false).tabindex(null);
				}
			});
		}

		PasswordField.prototype = new html.Element("div");
		html.PasswordField = PasswordField;

	}(crafity.html = crafity.html || {}));

}(window.crafity = window.crafity || {}));
/*jslint browser: true, nomen: true, vars: true, white: true */

(function (crafity) {
	"use strict";

	(function (html) {

		function Searchbox(callback) {
			var self = this;

			this._search = new html.Element("input")
				.attr("type", "search")
				.attr("name", "search")
				.attr("results", "5");

			if (callback) {
				this.on("change", callback);
			}

			this._search.addEventListener("keyup", function (e) {
				if (e.which === 13) {
					return;
					/* Handled by search event */
				}
				self.emit("change", self._search.value());
			});
			this._search.addEventListener("search", function () {
				self.emit("change", self._search.value());
			});

			this.append(this._search);
			this.addClass("searchbox");
		}

		Searchbox.prototype = new html.Element("div");
		Searchbox.prototype.focus = function () {
			this._search.focus();
			return this;
		};
		html.Searchbox = Searchbox;
		
	}(crafity.html = crafity.html || {}));

}(window.crafity = window.crafity || {}));
/*jslint browser: true, nomen: true, vars: true, white: true */

(function (crafity) {
	"use strict";

	(function (html) {

		function List() {
			var self = this;

			this._searchBox = new html.Searchbox();
			this.onsearch = function (filter) {
				if (!filter) {
					return;
				}
				self._searchBox.on("change", filter);
			};
			this._listitems = [];
			this.addClass("list");
			this._itemContainer = new html.Element("ul").addClass("itemContainer");

			this.append(this._searchBox);
			this.append(this._itemContainer);
		}

		List.prototype = new html.Element("div");
		List.prototype.focus = function () {
			this._searchBox.focus();
		};
		List.prototype.addListItem = function (listItem) {
			var self = this;

			listItem.on("click", function updateSelection() {
				self.getListItems().forEach(function (listitem) {
					if (listitem !== listItem) {
						listitem.deselect();
					}
				});
				listItem.select();
			});

			this._listitems.push(listItem);
			this._itemContainer.append(listItem);
		};
		List.prototype.addListItems = function (listItems) {
			var self = this;
			listItems.forEach(function (listItem) {
				self.addListItem(listItem);
			});
		};
		List.prototype.clearListItems = function () {
			this._itemContainer.clear();
			this._listitems = [];
		};
		List.prototype.getListItems = function () {
			return [].concat(this._listitems);
		};
		html.List = List;

		function ListItem(name, data) {
			var self = this;

			if (name !== undefined) {
				this.addClass("listitem");
				this.append(new html.Element("div").addClass("content").text(name));
			}
			this.tabindex("0");
			this.addEventListener(crafity.core.events.click, function () {
				self.emit("click", self);
			});
			this.addEventListener("focus", function () {
				self.emit("click", self);
			});
			this.data(data);
		}

		ListItem.prototype = new html.Element("li");
		ListItem.prototype.select = function () {
			this.addClass("selected");
			this.emit("selectionChanged", this);
			this.emit("selected", this);
			return this;
		};
		ListItem.prototype.selected = function () {
			return this.hasClass("selected");
		};
		ListItem.prototype.deselect = function () {
			this.removeClass("selected");
			this.emit("selectionChanged", this);
			this.emit("deselected", this);
			return this;
		};
		html.ListItem = ListItem;

		function MultiLineListItem(title, date, content, data) {
			var self = this;
			this.addClass("multiline listitem");
			this.append(new html.Element("div").addClass("title").text(title));
			this.append(new html.Element("div").addClass("date").text(date));
			this.append(new html.Element("div").addClass("content").text(content));
			this.data(data);
			this.tabindex("0");
			this.addEventListener(crafity.core.events.click, function () {
				self.emit("click", self);
			});
			this.addEventListener("focus", function () {
				self.emit("click", self);
			});
			
		}

		MultiLineListItem.prototype = Object.create(ListItem.prototype);
		MultiLineListItem.prototype.constructor = MultiLineListItem;

		html.MultiLineListItem = MultiLineListItem;

	}(crafity.html = crafity.html || {}));

}(window.crafity = window.crafity || {}));
/*jslint browser: true, nomen: true, vars: true, white: true, evil: true */
/*globals numeral, moment*/

(function (crafity) {
	"use strict";

	(function (html) {

		function Grid(columns) {
			var self = this;
			var container = new html.Element("div").addClass("container").appendTo(this);
			var table = new html.Element("table").attr("cellspacing", "0").appendTo(container);
			var thead = new html.Element("thead").appendTo(table).addClass("header");
			var headerRow = new html.Element("tr").appendTo(thead);

			var tbody = new html.Element("tbody").appendTo(table);
			var TYPE_DATE = "Date";
			var TYPE_NUMBER = "Number";

			var EMPTY_VALUE = " ";
			var ASC = "ascending";
			var DESC = "descending";

			var _rows = null;
			
			var keys = {};
			container.addEventListener("keydown",
				function (e) {
					keys[e.keyCode] = true;
					switch (e.keyCode) {
						case 37:
						case 39:
						case 38:
						case 40: // Arrow keys
						case 32:
							e.preventDefault();
							break; // Space
						default:
							break; // do not block other keys
					}
				},
				false);
			container.addEventListener('keyup',
				function (e) {
					keys[e.keyCode] = false;
				},
				false);

			this.addClass("grid");

			function sortRowsPerColumn(column, sortOrder) {
				var sortedRows = [];
				var valuesSortedPerColumn = _rows
					.map(function (row) {
						var value = row[column.property];
						if (typeof value === 'number' && isNaN(value)) {
							return "__NaN__";
						}
						return value;
					});
				valuesSortedPerColumn = valuesSortedPerColumn.filter(function onlyUnique(value, index) {
					return valuesSortedPerColumn.indexOf(value) === index;
				});

				var sortFunctions = {
					ascending: function (a, b) {
						if (a > b) {
							return 1;
						}
						if (a < b) {
							return -1;
						}
						return 0;
					},
					descending: function (a, b) {
						if (a > b) {
							return -1;
						}
						if (a < b) {
							return 1;
						}
						return 0;
					}
				};

				valuesSortedPerColumn.sort(sortFunctions[sortOrder]);

				valuesSortedPerColumn.forEach(function (sortedRowValue) {
					_rows.forEach(function (row) {

						if (row[column.property] === sortedRowValue ||
							(sortedRowValue === "__NaN__"
								&& typeof row[column.property] === 'number'
								&& isNaN(row[column.property]))) {
							sortedRows.push(row);
						}
					});
				});

				return sortedRows;
			}

			function addRows(rows) {
				rows.forEach(self.addRow);
			}

			this.addColumn = function (column) {
				var th = new html.Element("th").addClass("sortable");
				var stickyTH = new html.Element("div");
				var textSpan = new html.Element("span");

				stickyTH.append(textSpan.text(column.name)).addClass("sticky").appendTo(th);

				if (column.sortable) {
					th.addClass(column.sortable); // asc or desc
				}

				// event handler
				stickyTH.addEventListener(crafity.core.events.click, function () {

					var lastSortOrder;
					var newSortOrder;

					if (th.hasClass(ASC)) {
						lastSortOrder = ASC;
					} else if (th.hasClass(DESC)) {
						lastSortOrder = DESC;
					}

					headerRow.children().forEach(function (thElement) {
						thElement.removeClass(ASC).removeClass(DESC);
					});

					if (lastSortOrder === ASC) {
						th.addClass(newSortOrder = DESC);
					} else if (lastSortOrder === DESC) {
						th.addClass(newSortOrder = ASC);
					} else {
						th.addClass(newSortOrder = ASC); // default
					}

					var sortedRows = sortRowsPerColumn(column, newSortOrder);
					self.clearRows();
					addRows(sortedRows);

				});
				th.addClass("column").appendTo(headerRow);
			};

			this.addColumns = function (columns) {
				if (!columns) {
					throw new Error("Argument 'columns' is required");
				}
				columns.forEach(self.addColumn);
			};

			this.clearColumns = function () {
				headerRow.clear();
			};

			this.addRow = function (row) {
				var rowElement = new html.Element("tr").appendTo(tbody).addClass("row");

				function highlightRow() {
					tbody.children().forEach(function (child) {
						child.removeClass("selected");
					});
					rowElement.addClass("selected");
					self.emit("selectedGridRow", row);
				}

				rowElement.addEventListener(crafity.core.events.click, highlightRow);
				function open(key, e) {
					highlightRow();
					self.emit("open", row);
					e.preventDefault();
					return false;
				}

				rowElement.attr("tabindex", 0);
				crafity.keyboard.attach(rowElement).on("enter", open);
				rowElement.addEventListener("dblclick", open);

				columns.forEach(function (column) {
					var td = new html.Element("td").addClass("cell").appendTo(rowElement);

					if (column.options) {
						td.addClass("string");
					} else {
						td.addClass(column.type.toLowerCase());
					}

					var actualValue = row[column.property];

					if (actualValue === undefined || actualValue === null) {
						actualValue = EMPTY_VALUE;

					} else if (column.type === TYPE_NUMBER && typeof actualValue === "number" && !isNaN(actualValue)) {
						if (actualValue < 0) {
							td.addClass("negative");
						} else {
							td.addClass("positive");
						}
						if (column.format) {
							actualValue = numeral(actualValue).format(column.format);
						}
					} else if (column.type === TYPE_DATE) {
						if (column.format) {
							actualValue = moment(actualValue).format(column.format);
						}
					}
					var instantiate;

					if (column.editable) {
						instantiate = new Function("return new " + column.editable.control + "()");
						var editControl = instantiate();
						if (column.options) {
							editControl.options(column.options);
						}
						editControl.value(actualValue);
						if (column.editable.events && column.editable.events.length) {
							column.editable.events.forEach(function (event) {
								editControl.on(event, function () {
									var args = Array.prototype.slice.apply(arguments);
									self.emit.apply(self, [event, column, row].concat(args));
								});
							});
						}
						td.append(editControl);
					} else if (column.clickable) {
						instantiate = new Function("return new " + column.clickable.control + "()");
						var clickControl = instantiate();
						throw new Error("Not implemented");
//						if (column.options) { clickControl.options(column.options); }
						clickControl.text(actualValue.toString());
//						if (column.editable.events && column.editable.events.length) {
//							column.editable.events.forEach(function (event) {
//								clickControl.on(event, function () {
//									var args = Array.prototype.slice.apply(arguments);
//									self.emit.apply(self, [event, column, row].concat(args));
//								});
//							});
//						}
						td.append(clickControl);
					} else {
						td.text(actualValue.toString());
					}

				});
			};

			this.addRows = function (rows) {
				this.clearRows();

				if (!columns || !columns.length) {
					return;
				}

				_rows = rows;
				var sortedRows = [];
				var sorted = false;

				// 1. sort rows
				// NB this will sort the last winning sortable column in the array of columns
				columns.some(function (column) {
					if (column.sortable) {
						sorted = true;
						sortedRows = sortRowsPerColumn(column, column.sortable);
						return true;
					}
					return false;
				});
				if (!sorted) {
					sortedRows = rows;
				}

				// 2. add rows
				addRows(sortedRows);
			};

			this.clearRows = function () {
				tbody.clear();
				new html.Element("tr").appendTo(tbody).addClass("row top-spacer");
			};

			this.clearRows();

			if (columns) {
				this.addColumns(columns);
			}
		}

		Grid.prototype = new html.Element("div");
		html.Grid = Grid;

	}(crafity.html = crafity.html || {}));

}(window.crafity = window.crafity || {}));
		
/*jslint browser: true, nomen: true, vars: true, white: true */

(function (crafity) {
	"use strict";

	(function (html) {

		function ButtonBar() {
			this.addClass("buttonBar");
		}

		ButtonBar.prototype = new html.Element("div");
		html.ButtonBar = ButtonBar;
		
	}(crafity.html = crafity.html || {}));

}(window.crafity = window.crafity || {}));
/*jslint browser: true, nomen: true, vars: true, white: true */

(function (crafity) {
	"use strict";

	(function (html) {

		function Button(text) {
			var self = this;
			this.addClass("button");
			this.text(text);
			this.attr("href", "#");
			this.addEventListener(crafity.core.events.click, function (e) {
				if (!self.disabled()) { 
					self.emit("click");
				}
				e.preventDefault();
				return false; 
			});
		}

		Button.prototype = new html.Element("a");
		html.Button = Button;
		
	}(crafity.html = crafity.html || {}));

}(window.crafity = window.crafity || {}));
		
/*jslint browser: true, nomen: true, vars: true, white: true */

(function (crafity) {
	"use strict";

	(function (html) {

		function Form() {
			this.addClass("form");
			this.on("readonlyChanged", function (value) {
				this.children().forEach(function (child) {
					child.readonly(value);
				});
			});
		}

		Form.prototype = new html.Element("form");
		Form.prototype.addField = function (field) {
			this.append(field);
			return this;
		};
		Form.prototype.verify = function () {
			var isValid = true;
			this.children().filter(function (child) {
				return !!child.verify;
			}).forEach(function (child) {
					isValid = child.verify() && isValid;
				});
			return isValid;
		};
		Form.prototype.focus = function () {
			html.Element.prototype.focus.apply(this, arguments);
			this.children().length && this.children()[0].focus();
			this.children().some(function (child) {
				if (!child.verify()) { child.focus(); }
				return !child.isValid();
			});
			return this;
		};

		Form.prototype.reset = function () {
			this.children().forEach(function (child) {
				child.reset();
			});
			return this;
		};

		html.Form = Form;

	}(crafity.html = crafity.html || {}));

}(window.crafity = window.crafity || {}));
/*jslint browser: true, nomen: true, vars: true, white: true */

(function (crafity) {
	"use strict";

	(function (html) {

		function Field() {
			this.addClass("field");
			this._innerSpan = new html.Element("span").addClass("border");
			this._label = new html.Element("label").append(this._innerSpan);
			this._control = null;
			this.append(this._label);
		}

		Field.prototype = new html.Element("div");
		Field.prototype.label = function (name) {
			if (!name) {
				return this._innerSpan.text();
			}
			this._innerSpan.text(name);
			return this;
		};
		Field.prototype.value = function (value) {
			if (!this._control) {
				throw new Error("Unable to get the value, because no _control has been assigned");
			}
			if (value === undefined) {
				return this._control.value();
			}
			this._control.value(value);
			return this;
		};
		Field.prototype.blur = function (callback) {
			if (!this._control) {
				throw new Error("Unable to register blur event, because no _control has been assigned");
			}
			this._control.blur(callback);
			return this;
		};
		Field.prototype.focus = function (callback) {
			if (!this._control) {
				throw new Error("Unable to register focus event, because no _control has been assigned");
			}
			this._control.focus(callback);
			return this;
		};
		Field.prototype.change = function (callback) {
			if (!this._control) {
				throw new Error("Unable to register change event, because no _control has been assigned");
			}
			this._control.change(callback);
			return this;
		};
		Field.prototype.reset = function () {
			this.removeClass("invalid");
			this._isValid = undefined; 
			this.value("");
			return this;
		};
		Field.prototype.verify = function () {
			if (this.isValid()) {
				this.removeClass("invalid");
			} else {
				this.addClass("invalid");
			}
			return this.isValid();
		};
		Field.prototype.required = function (value) {
			var self = this;
			if (value === true) {
				this.addClass("required");
				this._required = value;
				this.blur(function () {
					self.verify();
				});
			} else if (value === false) {
				this.removeClass("required");
				this._required = value;
			} else {
				return !!this._required;
			}
			return this;
		};
		Field.prototype.isValid = function () {
			return (!this._required || (this._required && !!this.value())) &&
				(this._isValid === undefined || this._isValid);
		};
		html.Field = Field;

	}(crafity.html = crafity.html || {}));

}(window.crafity = window.crafity || {}));
/*jslint browser: true, nomen: true, vars: true, white: true*/

(function (crafity) {
	"use strict";

	(function (html) {

		function TextField() {
			var self = this;
			crafity.core.mixin(this, html.Field);

			this.addClass("textfield edit");
			this._textField = this._control = new html.Element("input").attr("type", "text");
			this.append(this._textField);
			this.value = function (value) {
				if (value === undefined) {
					return this._textField.value();
				}
				this._textField.value(value);
				return this;

			};

			this.on("readonlyChanged", function (bool) {
				if (bool === true) {
					self.removeClass("edit").addClass("readonly")
						._textField.readonly(true).tabindex("-1");
				}
				if (bool === false) {
					self.addClass("edit").removeClass("readonly")
						._textField.readonly(false).tabindex(null);
				}
			});
		}

		TextField.prototype = new html.Element("div");
		html.TextField = TextField;

	}(crafity.html = crafity.html || {}));

}(window.crafity = window.crafity || {}));
/*jslint browser: true, nomen: true, vars: true, white: true*/
/*globals moment*/

(function (crafity) {
	"use strict";

	(function (html) {

		function DateField() {
			var self = this;

			crafity.core.mixin(this, html.Field);

			this._isValid = true;
			this.addClass("datefield edit");
			this._dateField = this._control = new html.Element("input").attr("type", "text");
			this.append(this._dateField);
			this.value = function (value) {
				if (value === undefined) {
					return this._dateField.value() && moment(this._dateField.value(), crafity.region).toDate() || null;
				}
				if (typeof value === 'string') {
					if (value === "") {
						this._dateField.value(value);
					} else {
					this._dateField.value(moment(value, crafity.region).format("l"));
					}
				} else if (value instanceof Date) {
					this._dateField.value(moment(value).format("l"));
				} else {
					throw new Error("Unknown Data type. Use a string or Date type");
				}
				return this;

			};
			this._dateField.addEventListener("blur", parseDate);
			this._dateField.addEventListener("change", parseDate);
			function parseDate(e) {
				var value = self._dateField.value();
				var parts;
				window.d = null;
				self._dateField.removeClass("invalid");
				self._isValid = true;
				self.verify();
				try {

					if (value.match(/^[0-9]{4,4}$/)) {
						return self._dateField.value(value.substr(0, 2) + '-' + value.substr(2, 2) + '-' + new Date().getFullYear());
					}
					if (value.match(/^[0-9]{6,6}$/)) {
						return self._dateField.value(value.substr(0, 2) + '-' + value.substr(2, 2) + '-20' + value.substr(4, 2));
					}
					if (value.match(/^[0-9]{8,8}$/)) {
						return self._dateField.value(value.substr(0, 2) + '-' + value.substr(2, 2) + '-' + value.substr(4, 4));
					}
					if (value.match(/^[0-9]{1,2}[\-][0-9]{1,2}$/)) {
						parts = value.split('-');
						parts[2] = new Date().getFullYear();
						return self._dateField.value(parts.join("-"));
					}
					if (value.match(/^[0-9]{1,2}[\-][0-9]{1,2}[\-][0-9]{1,1}$/)) {
						parts = value.split('-');
						parts[2] = "200" + parts[2];
						return self._dateField.value(parts.join("-"));
					}
					if (value.match(/^[0-9]{1,2}[\-][0-9]{1,2}[\-][0-9]{1,1}$/)) {
						parts = value.split('-');
						parts[2] = "200" + parts[2];
						return self._dateField.value(parts.join("-"));
					}
					if (value.match(/^[0-9]{1,2}[\-][0-9]{1,2}[\-][0-9]{2,2}$/)) {
						parts = value.split('-');
						parts[2] = "20" + parts[2];
						return self._dateField.value(parts.join("-"));
					}
					if (value.match(/^[0-9]{1,2}[\-][0-9]{1,2}[\-][0-9]{4,4}$/)) {
						return false;
					}
					if (value.length === 0) {
						return false;
					}
				} finally {
					if (self._dateField.value() && !moment(self._dateField.value(), crafity.region || "nl").isValid()) {
						self._isValid = false;
						self._dateField.focus();
						self._dateField.addClass("invalid");
						e.preventDefault();
						return false;
					} else if (self._dateField.value() === "") {
						return true;
					}
				}

				self._dateField.focus();
				self._dateField.addClass("invalid");
				self._isValid = false;
				e.preventDefault();
				return false;
			}

			this.on("readonlyChanged", function (bool) {
				if (bool === true) {
					self.removeClass("edit").addClass("readonly")
						._dateField.readonly(true).tabindex("-1")
						.attr("placeholder", "");
				}
				if (bool === false) {
					self.addClass("edit").removeClass("readonly")
						._dateField.readonly(false).tabindex(null)
						.attr("placeholder", "dd-mm-jjjj");
				}
			});

			this.change = function (callback) {
				if (callback === undefined) {
					throw new Error("Argument 'callback' is required");
				}
				this._dateField.change(function (value) {
					if (!self._isValid) { return; }
					if (value) {
						callback(moment(value, crafity.region || "nl").toDate());
					} else {
						callback(null);
					}
				});
				return this;
			};

		}

		DateField.prototype = new html.Element("div");
		html.DateField = DateField;

	}(crafity.html = crafity.html || {}));

}(window.crafity = window.crafity || {}));
/*jslint browser: true, nomen: true, vars: true, white: true*/

(function (crafity) {
	"use strict";

	(function (html) {
		var EMPTY_SELECT_VALUE = " ";
		
		function Selectbox() {
			var self = this;

			this._selectedValue = new html.Element("span").text(EMPTY_SELECT_VALUE);
			this.append(this._selectedValue);

			this._optionList = new Selectbox.OptionList();
			this.append(this._optionList);

			this._mouseInfo = this._optionList._mouseInfo;

			this._options = [];
			this.addClass("selectbox edit collapsed");
			this.tabindex("0");

			this._optionList
				.on("selected", function (value) {
					if (self.value() !== value) {
						self.value(value);
						self.emit("selected", value);
					}
					self.focus();
				})
				.blur(function () {
					self._mouseInfo.source = null;
					self._mouseInfo.isdown = false;
					self._mouseInfo.islong = false;

					if (self.readonly()) { return false; }
					return self.removeClass("expanded").addClass("collapsed");
				});

			this.on("readonlyChanged", function (bool) {
				if (bool === true) {
					self.removeClass("edit").addClass("readonly").tabindex("-1");
				}
				if (bool === false) {
					self.addClass("edit").removeClass("readonly").tabindex(null);
				}
				self._optionList.readonly(bool);
			});
			var showOptionListTimer;
			this.value = function (value) {
				if (value === undefined) {
					return self._optionList.value();
				}
				self._optionList.value(value);
				self._selectedValue.text(self._optionList.getFriendlyName() || EMPTY_SELECT_VALUE);
				return self;
			};

			function showOptionList(e) {
				clearTimeout(showOptionListTimer);
				showOptionListTimer = setTimeout(function () {
					if (self._mouseInfo.isdown) { self._mouseInfo.islong = true; }
				}, 400);

				self.addClass("expanded").removeClass("collapsed");
				self._optionList.show();

				// Now see if the top and the bottom of the options list fits on the screen
				var optionListElement = self._optionList.element();
				var rects = optionListElement.getClientRects();
				if (rects.length) {
					var top = rects[0].top;
					var bottom = rects[0].top + rects[0].height;
					var marginTop = optionListElement.style.marginTop.replace(/px$/i, "");
					if (top < 0) {
						optionListElement.style.marginTop = (parseInt(marginTop, 10) - top) + "px";
					}
					if (bottom > window.innerHeight) {
						optionListElement.style.marginTop = parseInt(marginTop, 10) - (bottom - window.innerHeight) + "px";
					}
				}
				e.preventDefault();
				return false;
			}

			function highlightSelectedItem(optionList) {
				function onmousemove() {
					optionList
						.removeEventListener("mousemove", onmousemove)
						.removeClass("nohover");
				}

				optionList
					.addClass("nohover")
					.removeEventListener("mousemove", onmousemove)
					.addEventListener("mousemove", onmousemove);
			}

			this.addEventListener("keydown", function (e) {
				if (e.defaultPrevented) { return; }
				if (self.readonly()) { return; }
				if ((e.keyCode === 13 || e.keyCode === 32) && !e.shiftKey && !e.ctrlKey && !e.metaKey && (e.target === self.element() || e.target === undefined)) {
					if (self._optionList.hasNotClass("visible")) {
						highlightSelectedItem(self._optionList);
						showOptionList(e);
					}
				}
			});
			this.addEventListener("mousedown", function (e) {
				if (self._mouseInfo.source !== null && self._mouseInfo.source !== self) { return true; }
				if (self.readonly()) { return; }
				self._mouseInfo.source = self;
				self._mouseInfo.isdown = true;
				self._mouseInfo.islong = false;
				return showOptionList(e);
			});
		}

		Selectbox.OptionList = function OptionList() {
			var self = this;
			this._elements = [];
			this._mouseInfo = {
				isdown: false,
				islong: false,
				source: null
			};
			this.addClass("option-list collapsed").tabindex("0");
			this.selectedItem = null;
			this.highlightedItem = null;
			this.addEventListener("blur", function () {
				if (self.readonly()) { return false; }
				if (self._mouseInfo.isdown) { return false; }
				self.removeClass("expanded").addClass("collapsed").removeClass("visible");
				self.emit("lostFocus");
			});
			this.value = function (value) {
				if (value === undefined) {
					return self._selectedValue;
				}
				self._selectedValue = value;
				self.selectedItem = null;
				self.highlightedItem = null;
				self.children().forEach(function (optionElement, index) {
					if (optionElement.attr("data-value") === (value || "").toString()) {
						self.selectedItem = optionElement;
						self.highlightedItem = optionElement;
						optionElement.addClass("selected");
						self.element().style.marginTop = -1 * (16 + 2) * index + "px";
					} else {
						optionElement.removeClass("selected");
					}
				});

				return self;
			};
		};
		Selectbox.OptionList.prototype = new html.Element("div");
		Selectbox.OptionList.prototype.options = function (options) {
			var self = this;
			var previousElement = null;
			self._elements = [];

			if (options === undefined) {
				return self._options;
			}
			self._options = options;
			self.selectedItem = null;
			self.highlightedItem = null;

			self.addEventListener("keydown", function (e) {
				if (self.readonly()) { return; }
				var currentItem = (self.highlightedItem || self.selectedItem) || (self.children().length && self.children()[0]);
				if (e.keyCode === 38 && !e.shiftKey && !e.ctrlKey && !e.metaKey) { // Up
					if (self.hasClass("visible")) {
						var previousOption = currentItem && currentItem.previousOption;
						self.removeClass("nohover");
						if (previousOption) {
							previousOption.addClass("hover");
							if (currentItem) { currentItem.removeClass("hover"); }
							self.highlightedItem = previousOption;
						}
						e.preventDefault();
						return false;
					}
				}
				if (e.keyCode === 40 && !e.shiftKey && !e.ctrlKey && !e.metaKey) { // Down
					if (self.hasClass("visible")) {
						var nextOption = currentItem && currentItem.nextOption;
						self.removeClass("nohover");
						self._elements.forEach(function (el) {
							el.removeClass("hover");
						});
						if (nextOption) {
							nextOption.addClass("hover");
							if (currentItem) { currentItem.removeClass("hover"); }
							self.highlightedItem = nextOption;
						}
						e.preventDefault();
						return false;
					}
				}
				if ((e.keyCode === 13 || e.keyCode === 32) && !e.shiftKey && !e.ctrlKey && !e.metaKey && (e.target === self.element() || e.target === undefined)) {
					self.hide().emit("selected", currentItem.attr("data-value"));
					e.preventDefault();
					return false;
				}
			});

			Object.keys(options).forEach(function (key, index) {
				var element = new html.Element("div")
					.addClass("option")
					.attr("data-value", key)
					.text(options[key]);
				self._elements.push(element);
				if (previousElement) {
					previousElement.nextOption = element;
					element.previousOption = previousElement;
				}
				element.nextOption = null;
				previousElement = element;

				self.append(element);
				element.addEventListener("mouseover", function () {
					self.removeClass("nohover");
					element.addClass("hover");
					if (self.highlightedItem) { self.highlightedItem.removeClass("hover"); }
					self.highlightedItem = element;
				});
				element.addEventListener("mouseout", function () {
					element.removeClass("hover");
				});
				element.addEventListener("mousedown", function (e) {
					self._mouseInfo.source = self;
					self._mouseInfo.isdown = true;
					self._mouseInfo.islong = false;
					self.focus();
					e.preventDefault();
					return false;
				});
				element.addEventListener("mouseup", function () {
					if (self._mouseInfo.islong || self._mouseInfo.source === self) {
						self.hide().emit("selected", key);
					}
					self._mouseInfo.source = null;
					self._mouseInfo.isdown = false;
					self._mouseInfo.islong = false;
				});
				if (self._selectedValue === options[key]) {
					self.selectedItem = element;
					self.highlightedItem = element;
					element.addClass("selected").addClass("hover");
					self.element().style.marginTop = -1 * (16 + 2) * index + "px";
				}
			});
			return self;
		};
		Selectbox.OptionList.prototype.getFriendlyName = function () {
			if (!this._options) {
				throw new Error("Unable to get friendly name because no options are specified")
			}
			return this._options[this.value()];
		};
		Selectbox.OptionList.prototype.show = function () {
			this.removeClass("collapsed").addClass("visible expanded").focus();
			if (this.selectedItem) { this.selectedItem.addClass("hover"); }
			return this;
		};
		Selectbox.OptionList.prototype.hide = function () {
			this.removeClass("visible expanded").addClass("collapsed").focus();
			return this;
		};

		Selectbox.prototype = new html.Element("div");
		Selectbox.prototype.options = function (options) {
			var self = this;
			if (options === undefined) {
				return self._optionList.options();
			}
			self._optionList.options(options);
			return self;

		};
		html.Selectbox = Selectbox;

	}(crafity.html = crafity.html || {}));

}(window.crafity = window.crafity || {}));
/*jslint browser: true, nomen: true, vars: true, white: true*/

(function (crafity) {
	"use strict";

	(function (html) {

		function SelectField() {
			var self = this;
			crafity.core.mixin(this, html.Field);

			this.addClass("selectfield edit");
			this._selectbox = this._control = new html.Selectbox();
			this._selectbox.on("selected", function (value) {
				self.verify();
				self.emit("selected", value);
			});

			this.options = function (options) {
				if (options === undefined) {
					return this._selectbox.options();
				}
				this._selectbox.options(options);
				return this;
			};

			this.append(this._selectbox);

			this._isreadonly = false;
			this.readonly = function (bool) {
				if (bool === true) {
					self.removeClass("edit").addClass("readonly");
					self._selectbox.readonly(true);
					self._selectbox.tabindex("-1");
					self._isreadonly = bool;
				} else if (bool === false) {
					self.addClass("edit").removeClass("readonly");
					self._selectbox.readonly(false);
					self._selectbox.tabindex("0");
					self._isreadonly = bool;
				} else {
					return self._isreadonly;
				}
				return self;
			};
		}

		SelectField.prototype = new html.Element("div");
		html.SelectField = SelectField;

	}(crafity.html = crafity.html || {}));

}(window.crafity = window.crafity || {}));
/*jslint browser: true, nomen: true, vars: true, white: true*/

(function (crafity) {
	"use strict";

	(function (html) {

		function ViewContainer() {
			var self = this;
			this.activate = function (view) {
				self.children().forEach(function (child) {
					if (child === view) {
						child.show();
					} else {
						child.hide();
					}
				});
				self.append(view);
			};
			this.deactivateAll = function () {
				self.children().forEach(function (child) {
					child.hide();
				});
			};
		}
		ViewContainer.prototype = new crafity.html.Element("div");
		
		html.ViewContainer = ViewContainer;
		
	}(crafity.html = crafity.html || {}));

}(window.crafity = window.crafity || {}));
		
/*jslint browser: true, nomen: true, vars: true, white: true */

(function (crafity) {
	"use strict";

	var html = new crafity.html.Element(document.documentElement).addClass("active");

	if (window.onfocusout !== null) { // Meaning not IE...
		window.addEventListener("blur", function () {
			html.addClass("inactive").removeClass("active");
		});
		window.addEventListener("focus", function () {
			html.addClass("active").removeClass("inactive");
		});
	}

}(window.crafity = window.crafity || {}));
		
		
