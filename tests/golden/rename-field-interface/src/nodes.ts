import { graphql } from "./gql";

const NodeQuery = graphql`
  query GetNode($id: ID!) {
    node(id: $id) {
      id
      fullName
      ... on User {
        lastName
      }
      ... on Admin {
        role
      }
    }
  }
`;
