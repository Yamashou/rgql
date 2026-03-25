/**
 * Pure functions for detecting interface-level impact of field renames.
 *
 * When a field is renamed on a type that implements an interface (or on the
 * interface itself), all implementing types must be updated together to keep
 * the GraphQL schema valid. These functions detect such situations.
 *
 * @module
 */
import type { GraphQLSchema } from "graphql";
import { isObjectType, isInterfaceType } from "graphql";
import type { InterfaceImpact } from "../types/domain";

/**
 * Returns all ObjectTypes that implement the given interface and have the specified field.
 *
 * @precondition `interfaceName` must be a valid interface name in the schema.
 * @postcondition Every returned entry has `fieldName` in its field map.
 */
function findImplementingTypesWithField(
  schema: GraphQLSchema,
  interfaceName: string,
  fieldName: string,
): readonly { readonly typeName: string }[] {
  return Object.entries(schema.getTypeMap())
    .filter(
      ([, candidateType]) =>
        isObjectType(candidateType) &&
        candidateType.getInterfaces().some((iface) => iface.name === interfaceName) &&
        candidateType.getFields()[fieldName] != null,
    )
    .map(([name]) => ({ typeName: name }));
}

/**
 * Returns the interface name that defines the given field on the ObjectType, or null.
 *
 * @precondition `objectTypeName` should be an ObjectType in the schema.
 * @postcondition If non-null, the returned interface has `fieldName` in its field map.
 */
function findInterfaceDefiningField(
  schema: GraphQLSchema,
  objectTypeName: string,
  fieldName: string,
): string | null {
  const type = schema.getType(objectTypeName);
  if (!type || !isObjectType(type)) return null;

  const matchingInterface = type
    .getInterfaces()
    .find((iface) => iface.getFields()[fieldName] != null);

  return matchingInterface?.name ?? null;
}

/**
 * Detects impact when renaming a field on an interface itself.
 *
 * @postcondition If non-null, `implementingTypes` has at least one entry.
 * @returns null if `interfaceName` is not an interface or the field doesn't exist on it.
 */
function checkImpactFromInterface(
  schema: GraphQLSchema,
  interfaceName: string,
  fieldName: string,
): InterfaceImpact | null {
  const type = schema.getType(interfaceName);
  if (!type || !isInterfaceType(type)) return null;
  if (!type.getFields()[fieldName]) return null;

  const implementingTypes = findImplementingTypesWithField(schema, interfaceName, fieldName);
  if (implementingTypes.length === 0) return null;

  return { interfaceName, fieldName, implementingTypes };
}

/**
 * Detects impact when renaming a field on an ObjectType that originates from an interface.
 * Returns the interface and all sibling implementing types.
 *
 * @postcondition If non-null, `implementingTypes` includes the original `objectTypeName`.
 * @returns null if the field is not inherited from any interface.
 */
function checkImpactFromObjectType(
  schema: GraphQLSchema,
  objectTypeName: string,
  fieldName: string,
): InterfaceImpact | null {
  const interfaceName = findInterfaceDefiningField(schema, objectTypeName, fieldName);
  if (!interfaceName) return null;

  const siblingTypes = findImplementingTypesWithField(schema, interfaceName, fieldName).filter(
    (implementingType) => implementingType.typeName !== objectTypeName,
  );

  return {
    interfaceName,
    fieldName,
    implementingTypes: [{ typeName: objectTypeName }, ...siblingTypes],
  };
}

/**
 * Checks whether renaming a field would break interface contracts.
 *
 * Tries interface-side impact first (the type IS an interface), then
 * ObjectType-side (the type implements an interface defining this field).
 *
 * @precondition `typeName` exists in the schema.
 * @postcondition If non-null, the rename affects multiple types that share the field
 *                through an interface contract.
 *
 * @returns An {@link InterfaceImpact} describing affected types, or null if no impact.
 */
export function checkInterfaceImpact(
  schema: GraphQLSchema,
  typeName: string,
  fieldName: string,
): InterfaceImpact | null {
  return (
    checkImpactFromInterface(schema, typeName, fieldName) ??
    checkImpactFromObjectType(schema, typeName, fieldName)
  );
}
