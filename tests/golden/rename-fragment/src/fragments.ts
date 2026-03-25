import { graphql } from "./gql";

const UserBasicFragment = graphql`
  fragment UserSummary on User {
    id
    name
  }
`;

const UserDetailQuery = graphql`
  query GetUserDetail($id: ID!) {
    user(id: $id) {
      ...UserSummary
      email
    }
  }
`;
