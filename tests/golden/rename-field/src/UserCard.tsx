import { graphql } from "./gql";

const UserQuery = graphql`
  query GetUser($id: ID!) {
    user(id: $id) {
      id
      fullName
      lastName
    }
  }
`;

const ProductQuery = graphql`
  query GetProduct($id: ID!) {
    product(id: $id) {
      id
      firstName
      price
    }
  }
`;

export function UserCard({ id }: { id: string }) {
  return <div>User Card</div>;
}
