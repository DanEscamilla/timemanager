import { app } from '@getcronit/pylon';
import { resolvers } from './graphql/resolvers/resolvers.ts';

// Define the GraphQL schema and resolvers
export const graphql = {
  ...resolvers,
};

// Export the app for Pylon
export default app;