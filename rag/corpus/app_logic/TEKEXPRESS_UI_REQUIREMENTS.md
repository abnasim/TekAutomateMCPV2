# TekExpress Command UI Requirements

## Problem Statement

TekExpress commands have special requirements that need UI support:

1. **Conditional Arguments**: Some arguments' valid values depend on another argument's value
   - Example: `TEKEXP:VALUE GENERAL` - the `value` argument depends on which `parametername` is selected

2. **Query vs Set Arguments**: Query commands should NOT show set-only arguments
   - Example: `TEKEXP:SELECT? TEST` should only show the command, not the `testname` and `value` arguments

3. **Large Enumerations**: Some commands have 100+ valid values that need special UI (tree view, card selection)

## JSON Structure Changes

### 1. Conditional Arguments

Arguments that depend on other arguments now have:
```json
{
  "name": "value",
  "dependsOn": "parametername",
  "validValues": {
    "type": "enumeration",
    "conditionalValues": {
      "ParameterName1": ["Value1", "Value2"],
      "ParameterName2": ["Value3", "Value4"]
    }
  }
}
```

### 2. Query-Only Arguments

Arguments that should NOT appear in queries:
```json
{
  "name": "value",
  "queryOnly": true  // Only show in SET commands, hide in QUERY commands
}
```

### 3. Query Arguments Specification

In syntax object:
```json
{
  "syntax": {
    "set": "TEKEXP:VALUE GENERAL,\"<ParameterName>\",\"<Value>\"",
    "query": "TEKEXP:VALUE? GENERAL,\"<ParameterName>\"",
    "queryArguments": ["parametername"]  // Only these args are used in queries
  }
}
```

## UI Implementation Requirements

### 1. Conditional Value Filtering

When rendering argument dropdowns:
- Check if argument has `dependsOn` field
- If yes, watch the parent argument's value
- Filter `conditionalValues` based on parent's current value
- Update dropdown options dynamically

**Example Code:**
```typescript
const getValidValues = (arg: Argument, parentValues: Record<string, any>) => {
  if (arg.dependsOn && arg.validValues?.conditionalValues) {
    const parentValue = parentValues[arg.dependsOn];
    return arg.validValues.conditionalValues[parentValue] || [];
  }
  return arg.validValues?.values || [];
};
```

### 2. Query Command Argument Filtering

When command type is "query" or "both":
- Check `syntax.queryArguments` to see which arguments are used in queries
- OR check each argument's `queryOnly` flag
- Hide arguments that are `queryOnly: true` when in query mode
- Only show arguments listed in `queryArguments` for queries

**Example Code:**
```typescript
const shouldShowArgument = (arg: Argument, isQuery: boolean, queryArguments: string[]) => {
  if (isQuery) {
    // Only show arguments specified in queryArguments
    return queryArguments.includes(arg.name);
  }
  // In set mode, show all arguments except those marked queryOnly
  return !arg.queryOnly;
};
```

### 3. Command Generation

When generating the command string:
- For queries: Only substitute arguments listed in `queryArguments`
- For sets: Substitute all arguments (except those marked `queryOnly` if somehow shown)

**Example Code:**
```typescript
const generateCommand = (syntax: Syntax, isQuery: boolean, paramValues: Record<string, any>) => {
  const template = isQuery ? syntax.query : syntax.set;
  const argsToUse = isQuery 
    ? (syntax.queryArguments || [])
    : Object.keys(paramValues);
  
  // Only substitute arguments that should be used
  // ... substitution logic
};
```

## Commands Requiring Special Handling

### 1. TEKEXP:SELECT TEST
- **Issue**: 100+ test names in enumeration
- **Solution**: Use tree view or card selection UI
- **JSON**: Has `uiHint` field with `type: "tree_view"`

### 2. TEKEXP:VALUE GENERAL
- **Issue**: Value depends on ParameterName
- **Solution**: Dynamic filtering based on `conditionalValues`
- **JSON**: Has `dependsOn` and `conditionalValues` structure

### 3. All Query Commands
- **Issue**: Queries showing set arguments
- **Solution**: Use `queryArguments` or `queryOnly` flags
- **JSON**: Syntax object has `queryArguments` array

## Testing Checklist

- [ ] Conditional arguments update when parent changes
- [ ] Query commands don't show set-only arguments
- [ ] Query command generation uses correct syntax
- [ ] Large enumerations use appropriate UI (tree/card)
- [ ] Command preview updates correctly for both set and query modes


