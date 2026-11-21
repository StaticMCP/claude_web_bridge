import { describe, it, expect } from 'vitest';
import { z } from 'zod';
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
      expect(result.name).toBeInstanceOf(z.ZodString);
      expect(result.name.description).toBe('User name');
      expect(result.name.safeParse(undefined).success).toBe(false);
      expect(result.name.safeParse('Ada').success).toBe(true);
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
      expect(result.age).toBeInstanceOf(z.ZodOptional);
      expect(result.age.unwrap()).toBeInstanceOf(z.ZodNumber);
      expect(result.age.unwrap().description).toBe('User age');
      expect(result.age.safeParse(undefined).success).toBe(true);
      expect(result.age.safeParse(1.5).success).toBe(true);
      expect(result.age.safeParse('30').success).toBe(false);
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
      expect(result.count).toBeInstanceOf(z.ZodNumber);
      expect(result.count.description).toBe('Item count');
      expect(result.count.safeParse(1.5).success).toBe(false);
      expect(result.count.safeParse(2).success).toBe(true);
      expect(result.count.safeParse(undefined).success).toBe(false);
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
      expect(result.active).toBeInstanceOf(z.ZodOptional);
      expect(result.active.unwrap()).toBeInstanceOf(z.ZodBoolean);
      expect(result.active.unwrap().description).toBe('Is active');
      expect(result.active.safeParse(undefined).success).toBe(true);
      expect(result.active.safeParse(true).success).toBe(true);
      expect(result.active.safeParse('yes').success).toBe(false);
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
      expect(result.data).toBeInstanceOf(z.ZodOptional);
      expect(result.data.unwrap()).toBeInstanceOf(z.ZodAny);
      expect(result.data.unwrap().description).toBe('Some data');
      expect(result.data.safeParse(undefined).success).toBe(true);
      expect(result.data.safeParse({ anything: true }).success).toBe(true);
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
      expect(result.required_field).toBeInstanceOf(z.ZodString);
      expect(result.required_field.description).toBe('Required field');
      expect(result.required_field.safeParse(undefined).success).toBe(false);
      expect(result.required_field.isOptional()).toBe(false);
      expect(result.optional_field).toBeInstanceOf(z.ZodOptional);
      expect(result.optional_field.unwrap()).toBeInstanceOf(z.ZodString);
      expect(result.optional_field.unwrap().description).toBe('Optional field');
      expect(result.optional_field.safeParse(undefined).success).toBe(true);
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