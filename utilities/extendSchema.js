"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.extendSchema = extendSchema;

var _objectValues = _interopRequireDefault(require("../polyfills/objectValues"));

var _inspect = _interopRequireDefault(require("../jsutils/inspect"));

var _mapValue = _interopRequireDefault(require("../jsutils/mapValue"));

var _invariant = _interopRequireDefault(require("../jsutils/invariant"));

var _devAssert = _interopRequireDefault(require("../jsutils/devAssert"));

var _kinds = require("../language/kinds");

var _predicates = require("../language/predicates");

var _validate = require("../validation/validate");

var _directives = require("../type/directives");

var _scalars = require("../type/scalars");

var _introspection = require("../type/introspection");

var _schema = require("../type/schema");

var _definition = require("../type/definition");

var _buildASTSchema = require("./buildASTSchema");

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function ownKeys(object, enumerableOnly) { var keys = Object.keys(object); if (Object.getOwnPropertySymbols) { var symbols = Object.getOwnPropertySymbols(object); if (enumerableOnly) symbols = symbols.filter(function (sym) { return Object.getOwnPropertyDescriptor(object, sym).enumerable; }); keys.push.apply(keys, symbols); } return keys; }

function _objectSpread(target) { for (var i = 1; i < arguments.length; i++) { var source = arguments[i] != null ? arguments[i] : {}; if (i % 2) { ownKeys(source, true).forEach(function (key) { _defineProperty(target, key, source[key]); }); } else if (Object.getOwnPropertyDescriptors) { Object.defineProperties(target, Object.getOwnPropertyDescriptors(source)); } else { ownKeys(source).forEach(function (key) { Object.defineProperty(target, key, Object.getOwnPropertyDescriptor(source, key)); }); } } return target; }

function _defineProperty(obj, key, value) { if (key in obj) { Object.defineProperty(obj, key, { value: value, enumerable: true, configurable: true, writable: true }); } else { obj[key] = value; } return obj; }

/**
 * Produces a new schema given an existing schema and a document which may
 * contain GraphQL type extensions and definitions. The original schema will
 * remain unaltered.
 *
 * Because a schema represents a graph of references, a schema cannot be
 * extended without effectively making an entire copy. We do not know until it's
 * too late if subgraphs remain unchanged.
 *
 * This algorithm copies the provided schema, applying extensions while
 * producing the copy. The original schema remains unaltered.
 *
 * Accepts options as a third argument:
 *
 *    - commentDescriptions:
 *        Provide true to use preceding comments as the description.
 *
 */
function extendSchema(schema, documentAST, options) {
  (0, _schema.assertSchema)(schema);
  documentAST && documentAST.kind === _kinds.Kind.DOCUMENT || (0, _devAssert.default)(0, 'Must provide valid Document AST.');

  if (!options || !(options.assumeValid || options.assumeValidSDL)) {
    (0, _validate.assertValidSDLExtension)(documentAST, schema);
  } // Collect the type definitions and extensions found in the document.


  var typeDefs = [];
  var typeExtensionsMap = Object.create(null); // New directives and types are separate because a directives and types can
  // have the same name. For example, a type named "skip".

  var directiveDefs = [];
  var schemaDef; // Schema extensions are collected which may add additional operation types.

  var schemaExtensions = [];

  for (var _i2 = 0, _documentAST$definiti2 = documentAST.definitions; _i2 < _documentAST$definiti2.length; _i2++) {
    var def = _documentAST$definiti2[_i2];

    if (def.kind === _kinds.Kind.SCHEMA_DEFINITION) {
      schemaDef = def;
    } else if (def.kind === _kinds.Kind.SCHEMA_EXTENSION) {
      schemaExtensions.push(def);
    } else if ((0, _predicates.isTypeDefinitionNode)(def)) {
      typeDefs.push(def);
    } else if ((0, _predicates.isTypeExtensionNode)(def)) {
      var extendedTypeName = def.name.value;
      var existingTypeExtensions = typeExtensionsMap[extendedTypeName];
      typeExtensionsMap[extendedTypeName] = existingTypeExtensions ? existingTypeExtensions.concat([def]) : [def];
    } else if (def.kind === _kinds.Kind.DIRECTIVE_DEFINITION) {
      directiveDefs.push(def);
    }
  } // If this document contains no new types, extensions, or directives then
  // return the same unmodified GraphQLSchema instance.


  if (Object.keys(typeExtensionsMap).length === 0 && typeDefs.length === 0 && directiveDefs.length === 0 && schemaExtensions.length === 0 && !schemaDef) {
    return schema;
  }

  var astBuilder = new _buildASTSchema.ASTDefinitionBuilder(options, function (typeName) {
    var type = typeMap[typeName];

    if (type === undefined) {
      throw new Error("Unknown type: \"".concat(typeName, "\"."));
    }

    return type;
  });
  var typeMap = astBuilder.buildTypeMap(typeDefs);
  var schemaConfig = schema.toConfig();

  for (var _i4 = 0, _schemaConfig$types2 = schemaConfig.types; _i4 < _schemaConfig$types2.length; _i4++) {
    var existingType = _schemaConfig$types2[_i4];
    typeMap[existingType.name] = extendNamedType(existingType);
  }

  var operationTypes = _objectSpread({
    // Get the extended root operation types.
    query: schemaConfig.query && replaceNamedType(schemaConfig.query),
    mutation: schemaConfig.mutation && replaceNamedType(schemaConfig.mutation),
    subscription: schemaConfig.subscription && replaceNamedType(schemaConfig.subscription)
  }, astBuilder.getOperationTypes(concatMaybeArrays(schemaDef && [schemaDef], schemaExtensions) || [])); // Then produce and return a Schema with these types.


  return new _schema.GraphQLSchema(_objectSpread({}, operationTypes, {
    types: (0, _objectValues.default)(typeMap),
    directives: [].concat(schemaConfig.directives.map(replaceDirective), astBuilder.buildDirectives(directiveDefs)),
    astNode: schemaDef || schemaConfig.astNode,
    extensionASTNodes: concatMaybeArrays(schemaConfig.extensionASTNodes, schemaExtensions)
  })); // Below are functions used for producing this schema that have closed over
  // this scope and have access to the schema, cache, and newly defined types.

  function replaceType(type) {
    if ((0, _definition.isListType)(type)) {
      return new _definition.GraphQLList(replaceType(type.ofType));
    } else if ((0, _definition.isNonNullType)(type)) {
      return new _definition.GraphQLNonNull(replaceType(type.ofType));
    }

    return replaceNamedType(type);
  }

  function replaceNamedType(type) {
    // Note: While this could make early assertions to get the correctly
    // typed values, that would throw immediately while type system
    // validation with validateSchema() will produce more actionable results.
    return typeMap[type.name];
  }

  function replaceDirective(directive) {
    var config = directive.toConfig();
    return new _directives.GraphQLDirective(_objectSpread({}, config, {
      args: (0, _mapValue.default)(config.args, extendArg)
    }));
  }

  function extendNamedType(type) {
    if ((0, _introspection.isIntrospectionType)(type) || (0, _scalars.isSpecifiedScalarType)(type)) {
      // Builtin types are not extended.
      return type;
    } else if ((0, _definition.isScalarType)(type)) {
      return extendScalarType(type);
    } else if ((0, _definition.isObjectType)(type)) {
      return extendObjectType(type);
    } else if ((0, _definition.isInterfaceType)(type)) {
      return extendInterfaceType(type);
    } else if ((0, _definition.isUnionType)(type)) {
      return extendUnionType(type);
    } else if ((0, _definition.isEnumType)(type)) {
      return extendEnumType(type);
    } else if ((0, _definition.isInputObjectType)(type)) {
      return extendInputObjectType(type);
    } // Not reachable. All possible types have been considered.


    /* istanbul ignore next */
    (0, _invariant.default)(false, 'Unexpected type: ' + (0, _inspect.default)(type));
  }

  function extendInputObjectType(type) {
    var config = type.toConfig();
    var extensions = typeExtensionsMap[config.name] || [];
    return new _definition.GraphQLInputObjectType(_objectSpread({}, config, {
      fields: function fields() {
        return _objectSpread({}, (0, _mapValue.default)(config.fields, function (field) {
          return _objectSpread({}, field, {
            type: replaceType(field.type)
          });
        }), {}, astBuilder.buildInputFieldMap(extensions));
      },
      extensionASTNodes: concatMaybeArrays(config.extensionASTNodes, extensions)
    }));
  }

  function extendEnumType(type) {
    var config = type.toConfig();
    var extensions = typeExtensionsMap[type.name] || [];
    return new _definition.GraphQLEnumType(_objectSpread({}, config, {
      values: _objectSpread({}, config.values, {}, astBuilder.buildEnumValueMap(extensions)),
      extensionASTNodes: concatMaybeArrays(config.extensionASTNodes, extensions)
    }));
  }

  function extendScalarType(type) {
    var config = type.toConfig();
    var extensions = typeExtensionsMap[config.name] || [];
    return new _definition.GraphQLScalarType(_objectSpread({}, config, {
      extensionASTNodes: concatMaybeArrays(config.extensionASTNodes, extensions)
    }));
  }

  function extendObjectType(type) {
    var config = type.toConfig();
    var extensions = typeExtensionsMap[config.name] || [];
    return new _definition.GraphQLObjectType(_objectSpread({}, config, {
      interfaces: function interfaces() {
        return [].concat(type.getInterfaces().map(replaceNamedType), astBuilder.buildInterfaces(extensions));
      },
      fields: function fields() {
        return _objectSpread({}, (0, _mapValue.default)(config.fields, extendField), {}, astBuilder.buildFieldMap(extensions));
      },
      extensionASTNodes: concatMaybeArrays(config.extensionASTNodes, extensions)
    }));
  }

  function extendInterfaceType(type) {
    var config = type.toConfig();
    var extensions = typeExtensionsMap[config.name] || [];
    return new _definition.GraphQLInterfaceType(_objectSpread({}, config, {
      interfaces: function interfaces() {
        return [].concat(type.getInterfaces().map(replaceNamedType), astBuilder.buildInterfaces(extensions));
      },
      fields: function fields() {
        return _objectSpread({}, (0, _mapValue.default)(config.fields, extendField), {}, astBuilder.buildFieldMap(extensions));
      },
      extensionASTNodes: concatMaybeArrays(config.extensionASTNodes, extensions)
    }));
  }

  function extendUnionType(type) {
    var config = type.toConfig();
    var extensions = typeExtensionsMap[config.name] || [];
    return new _definition.GraphQLUnionType(_objectSpread({}, config, {
      types: function types() {
        return [].concat(type.getTypes().map(replaceNamedType), astBuilder.buildUnionTypes(extensions));
      },
      extensionASTNodes: concatMaybeArrays(config.extensionASTNodes, extensions)
    }));
  }

  function extendField(field) {
    return _objectSpread({}, field, {
      type: replaceType(field.type),
      args: (0, _mapValue.default)(field.args, extendArg)
    });
  }

  function extendArg(arg) {
    return _objectSpread({}, arg, {
      type: replaceType(arg.type)
    });
  }
}

function concatMaybeArrays() {
  // eslint-disable-next-line no-undef-init
  var result = undefined;

  for (var _len = arguments.length, arrays = new Array(_len), _key = 0; _key < _len; _key++) {
    arrays[_key] = arguments[_key];
  }

  for (var _i6 = 0; _i6 < arrays.length; _i6++) {
    var maybeArray = arrays[_i6];

    if (maybeArray) {
      result = result === undefined ? maybeArray : result.concat(maybeArray);
    }
  }

  return result;
}
