import json
from pathlib import Path
from jsonschema import validate, Draft202012Validator

ROOT = Path(__file__).resolve().parents[2]
SCHEMA_PATH = ROOT / 'docs' / 'group.schema.json'
DATA_PATH = ROOT / 'artifacts' / 'api' / 'group.json'


def main():
    schema = json.loads(SCHEMA_PATH.read_text('utf-8'))
    data = json.loads(DATA_PATH.read_text('utf-8'))
    Draft202012Validator.check_schema(schema)
    validate(instance=data, schema=schema)
    print('schema validation passed')

if __name__ == '__main__':
    main()
