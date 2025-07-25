import {
  Box,
  Button,
  Container,
  FormControl,
  FormLabel,
  Heading,
  Input,
  VStack,
  Text,
  Alert,
  AlertIcon,
  Link,
  Flex,
} from '@chakra-ui/react'
import { useState } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import { useAuthStore } from '../stores/authStore'

const LoginPage = () => {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const { login, isLoading, error, clearError } = useAuthStore()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    clearError()
    
    try {
      await login(email, password)
    } catch (error) {
      // Error is handled by the store
    }
  }

  return (
    <Flex minH="100vh" align="center" justify="center" bg="gray.50">
      <Container maxW="md" py={12}>
        <Box
          bg="white"
          py={8}
          px={8}
          shadow="lg"
          rounded="lg"
          border="1px"
          borderColor="gray.200"
        >
          <VStack spacing={6} align="stretch">
            <Box textAlign="center">
              <Heading size="lg" color="brand.600">
                Kingdom SaaS
              </Heading>
              <Text mt={2} color="gray.600">
                AI-Powered Business Platform
              </Text>
            </Box>

            {error && (
              <Alert status="error" rounded="md">
                <AlertIcon />
                {error}
              </Alert>
            )}

            <Box as="form" onSubmit={handleSubmit}>
              <VStack spacing={4}>
                <FormControl isRequired>
                  <FormLabel htmlFor="email">Email address</FormLabel>
                  <Input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="Enter your email"
                    bg="white"
                  />
                </FormControl>

                <FormControl isRequired>
                  <FormLabel htmlFor="password">Password</FormLabel>
                  <Input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter your password"
                    bg="white"
                  />
                </FormControl>

                <Button
                  type="submit"
                  colorScheme="brand"
                  size="lg"
                  fontSize="md"
                  isLoading={isLoading}
                  loadingText="Signing in..."
                  w="full"
                >
                  Sign In
                </Button>
              </VStack>
            </Box>

            <Box textAlign="center">
              <Text color="gray.600">
                Don't have an account?{' '}
                <Link
                  as={RouterLink}
                  to="/register"
                  color="brand.600"
                  fontWeight="semibold"
                >
                  Sign up
                </Link>
              </Text>
            </Box>

            <Box textAlign="center">
              <Link
                as={RouterLink}
                to="/forgot-password"
                color="brand.600"
                fontSize="sm"
              >
                Forgot your password?
              </Link>
            </Box>
          </VStack>
        </Box>
      </Container>
    </Flex>
  )
}

export default LoginPage