import { z } from 'zod';
export class SchemaConverter {
    static jsonSchemaToMcpInputSchema(jsonSchema) {
        const properties = jsonSchema.properties || {};
        const required = jsonSchema.required || [];
        const zodValidators = {};
        if (Object.keys(properties).length === 0) {
            return {};
        }
        for (const [propName, propSchema] of Object.entries(properties)) {
            if (typeof propSchema !== 'object' || !propSchema.type) {
                continue;
            }
            let validator;
            const isRequired = required.includes(propName);
            const description = propSchema.description || propName;
            switch (propSchema.type) {
                case 'string':
                    validator = z.string();
                    break;
                case 'number':
                    validator = z.number();
                    break;
                case 'integer':
                    validator = z.number().int();
                    break;
                case 'boolean':
                    validator = z.boolean();
                    break;
                default:
                    validator = z.any();
            }
            validator = validator.describe(description);
            if (!isRequired) {
                validator = validator.optional();
            }
            zodValidators[propName] = validator;
        }
        return zodValidators;
    }
}
//# sourceMappingURL=converter.js.map