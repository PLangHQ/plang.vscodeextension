
export type VariableEvent = any;

export type SimpleValue = {
    Name: string;
    Type: string;
    Value: any;
    ObjectReferenceId?: number | undefined;
};

export type ObjectValue = SimpleValue & {
    Events: VariableEvent[];
    IsSystemVariable: boolean;
    Initiated: boolean;
    Properties: any[];
    IsProperty: boolean;
    Created: Date;
    Updated: Date;
    Path: string;
    PathAsVariable: string;
};
