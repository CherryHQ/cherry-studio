# Seeding

Database seeding system for populating initial/builtin data on app startup.

## Documentation

See [Database Seeding Guide](../../../../../docs/references/data/database-seeding-guide.md) for full documentation.

## Quick Reference

To add a new seeder:
1. Create a synchronous class implementing `ISeeder` in `seeders/`
2. Add it to the `seeders` array in `seederRegistry.ts`
