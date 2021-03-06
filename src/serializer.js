var map = Ember.ArrayPolyfills.map;
var forEach = Ember.ArrayPolyfills.forEach;

DS.DjangoRESTSerializer = DS.RESTSerializer.extend({

  init: function() {
    this._super.apply(this, arguments);
  },

  /**
   * @method keyForType
   * @param {String} key
   * @returns String
   */
  keyForType: function(key) {
    return key + "_type";
  },

  /**
   * @method keyForEmbeddedType
   * @param {String} key
   * @returns String
   */
  keyForEmbeddedType: function(key) {
    return 'type';
  },

  extractDjangoPayload: function(store, type, payload) {
    type.eachRelationship(function(key, relationship){
      var embeddedTypeKey, isPolymorphic = false;
      if (relationship.options && relationship.options.polymorphic) {
        isPolymorphic = true;
      }
      if (!Ember.isNone(payload[key]) &&
          typeof(payload[key][0]) !== 'number' &&
            typeof(payload[key][0]) !== 'string' &&
              relationship.kind === 'hasMany') {
        if (Ember.typeOf(payload[key]) === 'array' && payload[key].length > 0) {
          if(isPolymorphic) {
            // If there is a hasMany polymorphic relationship, push each
            // item to the store individually, since they might not all
            // be the same type
            forEach.call(payload[key],function(hash) {
              var type = this.typeForRoot(hash.type);
              this.pushSinglePayload(store, type, hash);
            }, this);
          } else {
            var ids = payload[key].mapBy('id'); //todo find pk (not always id)
            this.pushArrayPayload(store, relationship.type, payload[key]);
            payload[key] = ids;
          }
        }
      }
      else if (!Ember.isNone(payload[key]) && typeof(payload[key]) === 'object' && relationship.kind === 'belongsTo') {
        var type = relationship.type;

        if(isPolymorphic) {
          type = this.typeForRoot(payload[key].type);
        }

        var id = payload[key].id;
        this.pushSinglePayload(store, type, payload[key]);

        if(!isPolymorphic) {
          payload[key] = id;
        }
      }
    }, this);
  },

  extractDjangoMetaPayload: function(payload) {
    if(payload.count && payload.results) {
      // this is a paginated result, compute pagination properties
      var page_match = new RegExp('page=([0-9]+)');
      var items = {
        total: payload['count'],
        first: 1,
        last: payload['results'].length,
        per_page: undefined,
      };
      var page = {
        total: 1,
        current: 1,
        previous: false,
        next: false,
      };

      // do we have a previous page?
      if(res = page_match.exec(payload['previous'])) {
        page.previous = parseInt(res[1], 10);
        page.current = page.previous + 1;

        // the number of items per page is calculated from number of
        // items in previous pages and the number of the previous page
        items.per_page = (payload['count'] - payload['results'].length) / page.previous;
      }

      // do we have a next page?
      if(res = page_match.exec(payload['next'])) {
        page.next = parseInt(res[1], 10);
        page.current = page.next - 1;

        // as we have a next page, we know that the current page is
        // full, so just count how many items are in the current page
        items.per_page = payload['results'].length;
      }

      if(items.per_page === undefined) {
        // `items.per_page` is not set, this happen when there is only
        // one page. And with only one page, we are not able to guess
        // the server-side configured value for the number of items per
        // page.
      } else {
        page.total = Math.ceil(payload['count'] / items.per_page);
        items.first = (page.current - 1) * items.per_page + 1;
        items.last = items.first + payload['results'].length - 1;
      }

      // add a pagination object in metadata
      return {
        page: page,
        items: items,
      };
    } else {
      return null;
    }
  },

  extractSingle: function(store, type, payload) {
    // using normalize from RESTSerializer applies transforms and allows
    // us to define keyForAttribute and keyForRelationship to handle
    // camelization correctly.
    this.normalize(type, payload);
    this.extractDjangoPayload(store, type, payload);
    return payload;
  },

  extractArray: function(store, type, payload) {
    var self = this;
    if(!payload.length && payload.count && payload.results) {
      payload = payload.results;
    }
    for (var j = 0; j < payload.length; j++) {
      // using normalize from RESTSerializer applies transforms and allows
      // us to define keyForAttribute and keyForRelationship to handle
      // camelization correctly.
      this.normalize(type, payload[j]);
      self.extractDjangoPayload(store, type, payload[j]);
    }
    return payload;
  },

  extractMeta: function(store, type, payload) {
    // extract count, next, prev, ... from paginated result
    // pagination = funccall()
    var pagination = this.extractDjangoMetaPayload(payload);
    if (payload && pagination) {
      store.metaForType(type, pagination);
      delete pagination;
    }
  },

  /**
   * This method allows you to push a single object payload.
   *
   * It will first normalize the payload, so you can use this to push
   * in data streaming in from your server structured the same way
   * that fetches and saves are structured.
   *
   * @param {DS.Store} store
   * @param {String} type
   * @param {Object} payload
   */
  pushSinglePayload: function(store, type, payload) {
    type = store.modelFor(type);
    payload = this.extract(store, type, payload, null, "find");
    store.push(type, payload);
  },

  /**
   * This method allows you to push an array of object payloads.
   *
   * It will first normalize the payload, so you can use this to push
   * in data streaming in from your server structured the same way
   * that fetches and saves are structured.
   *
   * @param {DS.Store} store
   * @param {String} type
   * @param {Object} payload
   */
  pushArrayPayload: function(store, type, payload) {
    type = store.modelFor(type);
    payload = this.extract(store, type, payload, null, "findAll");
    store.pushMany(type, payload);
  },

  /**
   * Converts camelcased attributes to underscored when serializing.
   *
   * Stolen from DS.ActiveModelSerializer.
   *
   * @method keyForAttribute
   * @param {String} attribute
   * @returns String
   */
  keyForAttribute: function(attr) {
    return Ember.String.decamelize(attr);
  },

  /**
   * Underscores relationship names when serializing relationship keys.
   *
   * Stolen from DS.ActiveModelSerializer.
   *
   * @method keyForRelationship
   * @param {String} key
   * @param {String} kind
   * @returns String
   */
  keyForRelationship: function(key, kind) {
    return Ember.String.decamelize(key);
  },

  /**
   * Adds support for skipping serialization of
   * DS.attr('foo', { readOnly: true })
   *
   * @method serializeAttribute
   */
  serializeAttribute: function(record, json, key, attribute) {
    if (!attribute.options.readOnly) {
      return this._super(record, json, key, attribute);
    }
  },

  /**
   * Underscore relationship names when serializing belongsToRelationships
   *
   * @method serializeBelongsTo
   */
  serializeBelongsTo: function(record, json, relationship) {
    var key = relationship.key;
    var belongsTo = record.get(key);
    var json_key = this.keyForRelationship ? this.keyForRelationship(key, "belongsTo") : key;

    if (Ember.isNone(belongsTo)) {
      json[json_key] = belongsTo;
    } else {
      if (typeof(record.get(key)) === 'string') {
        json[json_key] = record.get(key);
      }else{
        json[json_key] = record.get(key).get('id');
      }
    }

    if (relationship.options.polymorphic) {
      this.serializePolymorphicType(record, json, relationship);
    }
  },

  /**
   * Underscore relationship names when serializing hasManyRelationships
   *
   * @method serializeHasMany
   */
  serializeHasMany: function(record, json, relationship) {
    if (relationship.options.polymorphic) {
      // TODO implement once it's implemented in DS.JSONSerializer
      return;
    }

    var key = relationship.key,
    json_key = this.keyForRelationship(key, "hasMany"),
    relationshipType = DS.RelationshipChange ? DS.RelationshipChange.determineRelationshipType(record.constructor, relationship) : record.constructor.determineRelationshipType(relationship);

      if (relationshipType === 'manyToNone' || relationshipType === 'manyToMany') {
        json[json_key] = record.get(key).mapBy('id');
      }
  },

  /**
   * Add the key for a polymorphic relationship by adding `_type` to the
   * attribute and value from the model's underscored name.
   *
   * @method serializePolymorphicType
   * @param {DS.Model} record
   * @param {Object} json
   * @param {Object} relationship
   */
  serializePolymorphicType: function(record, json, relationship) {
    var key = relationship.key,
    belongsTo = Ember.get(record, key);
    key = this.keyForAttribute ? this.keyForAttribute(key) : key;
    if(belongsTo) {
      json[this.keyForType(key)] = Ember.String.underscore(belongsTo.constructor.typeKey);
    } else {
      json[this.keyForType(key)] = null;
    }
  },

  /**
   * Normalize:
   *
   * ```js
   * {
   *   minion: "1"
   *   minion_type: "evil_minion",
   *   author: {
   *     embeddedType: "user",
   *     id: 1
   *   }
   * }
   * ```
   *
   * To:
   *
   * ```js
   * {
   *   minion: "1"
   *   minionType: "evil_minion"
   *   author: {
   *     type: "user",
   *     id: 1
   *   }
   * }
   * ```
   * @method normalizeRelationships
   * @private
   */
  normalizeRelationships: function(type,hash) {
    this._super.apply(this, arguments);

    if (this.keyForRelationship) {
      type.eachRelationship(function(key, relationship) {
        if (relationship.options.polymorphic) {
          var typeKey = this.keyForType(relationship.key);
          if(hash[typeKey]) {
            var typeKeyCamelCase = typeKey.replace(/_type$/,'Type');
            hash[typeKeyCamelCase] = hash[typeKey];
            delete hash[typeKey];
          }

          if(hash[relationship.key]) {
            var embeddedData = hash[relationship.key];
            var embeddedTypeKey = this.keyForEmbeddedType(relationship.key);
            if(embeddedTypeKey !== 'type') {
              if(Ember.isArray(embeddedData) && embeddedData.length) {
                map.call(embeddedData, function(obj,i) {
                  this.normalizeTypeKey(obj,embeddedTypeKey);
                }, this);
              } else if(embeddedData[embeddedTypeKey]) {
                this.normalizeTypeKey(embeddedData,embeddedTypeKey);
              }
            }
          }
        }
      }, this);
    }
  },

  /**
   * Replace a custom type key with a key named `type`.
   *
   * @method normalizeTypeKey
   * @param {Object} obj
   * @param {String} key
   */
  normalizeTypeKey: function(obj,key) {
    obj.type = obj[key];
  }
});
