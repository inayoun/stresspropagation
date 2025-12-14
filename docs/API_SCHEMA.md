```json
{
  "version": "2.0",
  "nodes": [
    { "id": "node_cardiac_rhythm", "system": "Cardiac Rhythm" },
    { "id": "node_heart_rate", "system": "Heart Rate" },
    { "id": "node_breathing_rate", "system": "Breathing Rate" },
    { "id": "node_breathing_depth", "system": "Breathing Depth" },
    { "id": "node_sweat_level", "system": "Sweat Level" },
    { "id": "node_sweat_reactivity", "system": "Sweat Reactivity" },
    { "id": "node_skin_temperature", "system": "Skin Temperature" },
    { "id": "node_muscle_tension", "system": "Muscle Tension" }
  ],
  "calibration": {
    "nodes": {
      "node_id": {
        "units": "string",
        "transform": "identity | log1p",
        "inverse": "identity | expm1",
        "precision": 0,
        "mu": 0.0,
        "sigma": 1.0
      }
    }
  },
  "conditions": {
    "1": { "$ref": "#/definitions/condition" },
    "2": { "$ref": "#/definitions/condition" },
    "3": { "$ref": "#/definitions/condition" },
    "4": { "$ref": "#/definitions/condition" }
  },
  "static_raw": {
    "1": { "node_id": 0.0 },
    "2": { "node_id": 0.0 },
    "3": { "node_id": 0.0 },
    "4": { "node_id": 0.0 }
  }
}
```


```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://example.org/group.schema.json",
  "type": "object",
  "required": ["version", "nodes", "calibration", "conditions", "static_raw"],
  "properties": {
    "version": { "const": "2.0" },
    "nodes": {
      "type": "array",
      "minItems": 8,
      "items": {
        "type": "object",
        "required": ["id", "system"],
        "properties": {
          "id": { "type": "string", "enum": [
            "node_cardiac_rhythm", "node_heart_rate", "node_breathing_rate", "node_breathing_depth",
            "node_sweat_level", "node_sweat_reactivity", "node_skin_temperature", "node_muscle_tension"
          ]},
          "system": { "type": "string" }
        },
        "additionalProperties": false
      }
    },
    "calibration": {
      "type": "object",
      "required": ["nodes"],
      "properties": {
        "nodes": {
          "type": "object",
          "additionalProperties": {
            "type": "object",
            "required": ["units", "transform", "inverse", "precision", "mu", "sigma"],
            "properties": {
              "units": { "type": "string" },
              "transform": { "type": "string", "enum": ["identity", "log1p"] },
              "inverse": { "type": "string", "enum": ["identity", "expm1"] },
              "precision": { "type": "integer", "minimum": 0, "maximum": 6 },
              "mu": { "type": "number" },
              "sigma": { "type": "number", "exclusiveMinimum": 0 }
            },
            "additionalProperties": false
          }
        }
      },
      "additionalProperties": false
    },
    "conditions": {
      "type": "object",
      "properties": {
        "1": { "$ref": "#/definitions/condition" },
        "2": { "$ref": "#/definitions/condition" },
        "3": { "$ref": "#/definitions/condition" },
        "4": { "$ref": "#/definitions/condition" }
      },
      "additionalProperties": false
    },
    "static_raw": {
      "type": "object",
      "properties": {
        "1": { "$ref": "#/definitions/static_raw_for_condition" },
        "2": { "$ref": "#/definitions/static_raw_for_condition" },
        "3": { "$ref": "#/definitions/static_raw_for_condition" },
        "4": { "$ref": "#/definitions/static_raw_for_condition" }
      },
      "additionalProperties": false
    }
  },
  "additionalProperties": false,
  "definitions": {
    "condition": {
      "type": "object",
      "required": ["static", "series"],
      "properties": {
        "static": {
          "type": "object",
          "required": ["nodes", "edges"],
          "properties": {
            "nodes": {
              "type": "object",
              "additionalProperties": {
                "type": "object",
                "required": ["level", "slope", "accel", "var"],
                "properties": {
                  "level": { "type": "number" },
                  "slope": { "type": "number" },
                  "accel": { "type": "number" },
                  "var": { "type": "number", "minimum": 0 }
                },
                "additionalProperties": false
              }
            },
            "edges": {
              "type": "object",
              "additionalProperties": {
                "type": "object",
                "required": ["static_conn", "sync_rate", "significant"],
                "properties": {
                  "static_conn": { "type": "number", "minimum": 0, "maximum": 1 },
                  "sync_rate": { "type": "number", "minimum": 0, "maximum": 1 },
                  "significant": { "type": "boolean" }
                },
                "additionalProperties": false
              }
            }
          },
          "additionalProperties": false
        },
        "series": {
          "type": "object",
          "required": ["t", "nodes", "edges"],
          "properties": {
            "t": { "type": "array", "items": { "type": "number", "minimum": 0 } },
            "nodes": {
              "type": "object",
              "additionalProperties": {
                "type": "object",
                "required": ["level", "slope", "var"],
                "properties": {
                  "level": { "type": "array", "items": { "type": "number" } },
                  "slope": { "type": "array", "items": { "type": "number" } },
                  "var": { "type": "array", "items": { "type": "number", "minimum": 0 } }
                },
                "additionalProperties": false
              }
            },
            "edges": {
              "type": "object",
              "additionalProperties": {
                "type": "object",
                "required": ["sync", "conf"],
                "properties": {
                  "sync": { "type": "array", "items": { "type": "number", "minimum": -1, "maximum": 1 } },
                  "conf": { "type": "array", "items": { "type": "number", "minimum": 0, "maximum": 1 } }
                },
                "additionalProperties": false
              }
            }
          },
          "additionalProperties": false
        }
      },
      "additionalProperties": false
    },
    "static_raw_for_condition": {
      "type": "object",
      "additionalProperties": { "type": "number" }
    }
  }
}
```