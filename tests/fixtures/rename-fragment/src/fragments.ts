import { graphql } from "./gql";

const UserBasicFragment = graphql`
  fragment UserBasic on User {
    id
    name
  }
`;

const UserDetailQuery = graphql`
  query GetUserDetail($id: ID!) {
    user(id: $id) {
      ...UserBasic
      email
    }
  }
`;
