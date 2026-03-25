import { gql } from "graphql-tag";

const ProfileQuery = gql`
  query GetProfile($id: ID!) {
    user(id: $id) {
      firstName
      email
    }
  }
`;
