import { describe, it, expect } from 'vitest';
import { SchemaConverter } from '../src/converter';

describe('SchemaConverter', () => {
  describe('jsonSchemaToMcpInputSchema', () => {
    it('should return empty object for schema with no properties', () => {
      const schema = { type: 'object' };
      const result = SchemaConverter.jsonSchemaToMcpInputSchema(schema);
      expect(result).toEqual({});
    });

    it('should convert string property correctly', () => {
      const schema = {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'User name'
          }
        },
        required: ['name']
      };

      const result = SchemaConverter.jsonSchemaToMcpInputSchema(schema);
      expect(result).toHaveProperty('name');
      expect(result.name._def.typeName).toBe('ZodString');
      expect(result.name.isOptional()).toBe(false);
    });

    it('should convert number property correctly', () => {
      const schema = {
        type: 'object',
        properties: {
          age: {
            type: 'number',
            description: 'User age'
          }
        }
      };

      const result = SchemaConverter.jsonSchemaToMcpInputSchema(schema);
      expect(result).toHaveProperty('age');
      expect(result.age._def.typeName).toBe('ZodOptional');
      expect(result.age._def.innerType._def.typeName).toBe('ZodNumber');
      expect(result.age.isOptional()).toBe(true);
    });

    it('should convert integer property correctly', () => {
      const schema = {
        type: 'object',
        properties: {
          count: {
            type: 'integer',
            description: 'Item count'
          }
        },
        required: ['count']
      };

      const result = SchemaConverter.jsonSchemaToMcpInputSchema(schema);
      expect(result).toHaveProperty('count');
      expect(result.count._def.typeName).toBe('ZodNumber');
      expect(result.count.isOptional()).toBe(false);
    });

    it('should convert boolean property correctly', () => {
      const schema = {
        type: 'object',
        properties: {
          active: {
            type: 'boolean',
            description: 'Is active'
          }
        }
      };

      const result = SchemaConverter.jsonSchemaToMcpInputSchema(schema);
      expect(result).toHaveProperty('active');
      expect(result.active._def.typeName).toBe('ZodOptional');
      expect(result.active._def.innerType._def.typeName).toBe('ZodBoolean');
      expect(result.active.isOptional()).toBe(true);
    });

    it('should handle unknown types as any', () => {
      const schema = {
        type: 'object',
        properties: {
          data: {
            type: 'unknown-type',
            description: 'Some data'
          }
        }
      };

      const result = SchemaConverter.jsonSchemaToMcpInputSchema(schema);
      expect(result).toHaveProperty('data');
      expect(result.data._def.typeName).toBe('ZodOptional');
      expect(result.data._def.innerType._def.typeName).toBe('ZodAny');
    });

    it('should handle mixed required and optional properties', () => {
      const schema = {
        type: 'object',
        properties: {
          required_field: {
            type: 'string',
            description: 'Required field'
          },
          optional_field: {
            type: 'string',
            description: 'Optional field'
          }
        },
        required: ['required_field']
      };

      const result = SchemaConverter.jsonSchemaToMcpInputSchema(schema);
      expect(result.required_field.isOptional()).toBe(false);
      expect(result.optional_field.isOptional()).toBe(true);
    });

    it('should skip invalid property schemas', () => {
      const schema = {
        type: 'object',
        properties: {
          valid: {
            type: 'string',
            description: 'Valid field'
          },
          invalid: 'not an object',
          missing_type: {
            description: 'No type field'
          }
        },
        required: ['valid']
      };

      const result = SchemaConverter.jsonSchemaToMcpInputSchema(schema);
      expect(result).toHaveProperty('valid');
      expect(result).not.toHaveProperty('invalid');
      expect(result).not.toHaveProperty('missing_type');
    });
  });
});