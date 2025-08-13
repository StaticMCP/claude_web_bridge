interface JsonSchema {
    type: string;
    properties?: Record<string, any>;
    required?: string[];
    [key: string]: any;
}
export declare class SchemaConverter {
    static jsonSchemaToMcpInputSchema(jsonSchema: JsonSchema): Record<string, any>;
}
export {};
//# sourceMappingURL=converter.d.ts.map