import React, {useEffect, useState} from 'react';
import {
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  useColorScheme,
  NativeModules,
  DeviceEventEmitter,
  TextInput,
} from 'react-native';
import RNFS from "react-native-fs";

import {
  Colors,
  DebugInstructions,
  Header,
  LearnMoreLinks,
  ReloadInstructions,
} from 'react-native/Libraries/NewAppScreen';
import {
  Text,
  GluestackUIProvider,
  Checkbox,
  CheckboxIndicator,
  CheckboxIcon,
  CheckIcon,
  CheckboxLabel,
  Input,
  InputField,
  ButtonText,
  ButtonIcon,
  Button,
  Spinner,
  View,
  ButtonSpinner,
} from "@gluestack-ui/themed"
import { config } from "@gluestack-ui/config" // Optional if you want to use default theme

// @ts-ignore
import PassportReader from 'react-native-passport-reader';
import {checkInputs, getFirstName} from './utils/checks';
import {
  DEFAULT_PNUMBER,
  DEFAULT_DOB,
  DEFAULT_DOE,
  DEFAULT_ADDRESS,
  LOCAL_IP,
} from '@env';
import {DataHash, PassportData} from './types/passportData';
import {arraysAreEqual, bytesToBigDecimal, dataHashesObjToArray, formatAndConcatenateDataHashes, formatDuration, formatMrz, formatProof, splitToWords} from './utils/utils';
import {hash, toUnsignedByte} from './utils/computeEContent';
const rapidsnark = NativeModules.Rapidsnark;

console.log('DEFAULT_PNUMBER', DEFAULT_PNUMBER);
console.log('LOCAL_IP', LOCAL_IP);

const CACHE_DATA_IN_LOCAL_SERVER = false;
const SKIP_SCAN = false;

const attributeToPosition = {
  issuing_state: [2, 5],
  name: [5, 44],
  passport_number: [44, 52],
  nationality: [54, 57],
  date_of_birth: [57, 63],
  gender: [64, 65],
  expiry_date: [65, 71],
}

function App(): JSX.Element {
  const isDarkMode = useColorScheme() === 'dark';
  const [passportNumber, setPassportNumber] = useState(DEFAULT_PNUMBER ?? '');
  const [dateOfBirth, setDateOfBirth] = useState(DEFAULT_DOB ?? '');
  const [dateOfExpiry, setDateOfExpiry] = useState(DEFAULT_DOE ?? '');
  const [address, setAddress] = useState(DEFAULT_ADDRESS ?? '');
  const [passportData, setPassportData] = useState<PassportData | null>(null);
  const [step, setStep] = useState('scanCompleted');
  const [testResult, setTestResult] = useState<any>(null);
  const [error, setError] = useState<any>(null);

  const [generatingProof, setGeneratingProof] = useState<boolean>(false);

  const [proofTime, setProofTime] = useState<number>(0);
  const [totalTime, setTotalTime] = useState<number>(0);
  const [proofResult, setProofResult] = useState<string>('');

  const [minting, setMinting] = useState<boolean>(false);

  const [disclosure, setDisclosure] = useState({
    issuing_state: false,
    name: false,
    passport_number: false,
    nationality: false,
    date_of_birth: false,
    gender: false,
    expiry_date: false,
  });
  
  const handleDisclosureChange = (field: keyof typeof disclosure) => {
    setDisclosure(
      {...disclosure,
        [field]: !disclosure[field]
      });
  };

  const backgroundStyle = {
    backgroundColor: isDarkMode ? Colors.darker : Colors.lighter,
  };

  useEffect(() => {
    const logEventListener = DeviceEventEmitter.addListener('LOG_EVENT', e => {
      console.log(e);
    });

    return () => {
      logEventListener.remove();
    };
  }, []);

  if (SKIP_SCAN && passportData === null) {
    console.log('skipping scan step...');
    try {
      fetch(`${LOCAL_IP}/passportData`)
        .then(response => response.json())
        .then(data => {
          console.log('passport data fetched');
          setPassportData(data);
          setStep('scanCompleted');
        });
    } catch (err) {
      console.log('error fetching passport data', err);
    }
  }

  async function handleResponse(response: any) {
    const {
      mrz,
      signatureAlgorithm,
      modulus,
      curveName,
      publicKeyQ,
      dataGroupHashes,
      eContent,
      encryptedDigest,
    } = response;

    const passportData: PassportData = {
      mrz: mrz.replace(/\n/g, ''),
      signatureAlgorithm: signatureAlgorithm,
      pubKey: {
        modulus: modulus,
        curveName: curveName,
        publicKeyQ: publicKeyQ,
      },
      dataGroupHashes: dataHashesObjToArray(JSON.parse(dataGroupHashes)),
      eContent: JSON.parse(eContent),
      encryptedDigest: JSON.parse(encryptedDigest),
    };

    console.log('mrz', passportData.mrz);
    console.log('signatureAlgorithm', passportData.signatureAlgorithm);
    console.log('pubKey', passportData.pubKey);
    console.log('dataGroupHashes', passportData.dataGroupHashes);
    console.log('eContent', passportData.eContent);
    console.log('encryptedDigest', passportData.encryptedDigest);

    setPassportData(passportData);

    if (CACHE_DATA_IN_LOCAL_SERVER) {
      // Caches data in local server to avoid having to scan the passport each time
      // For development purposes only
      fetch(`${LOCAL_IP}/post`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(passportData),
      })
        .then(response => response.json())
        .then(data => console.log(data.message))
        .catch(error => {
          console.log('error caching data in local server', error);
        });
    }

    setStep('scanCompleted');
  }


  

  async function scan() {
    checkInputs(passportNumber, dateOfBirth, dateOfExpiry);
    // 1. start a scan
    // 2. press the back of your android phone against the passport
    // 3. wait for the scan(...) Promise to get resolved/rejected
    console.log('scanning...');
    setStep('scanning');
    try {
      const response = await PassportReader.scan({
        documentNumber: passportNumber,
        dateOfBirth: dateOfBirth,
        dateOfExpiry: dateOfExpiry,
      });
      console.log('response', response);
      console.log('scanned');
      handleResponse(response);
    } catch (e) {
      console.log('error during scan :', e);
    }
  }

  const handleProve = async () => {

    setGeneratingProof(true)
    await new Promise(resolve => setTimeout(resolve, 10));

    async function readAssetFileInChunks(filename: string, chunkSize: number) {
      let currentPosition = 0;
      let accumulatedData = '';
      let fileInfo = await RNFS.stat(RNFS.DocumentDirectoryPath + '/' + filename);
      let fileSize = fileInfo.size;
    
      while (currentPosition < fileSize) {
        const chunk = await RNFS.read(RNFS.DocumentDirectoryPath + '/' + filename, chunkSize, currentPosition, 'base64');
        accumulatedData += chunk;
        currentPosition += chunkSize; // Increment by chunkSize instead of chunk.length due to base64 encoding
      }
    
      return accumulatedData;
    }
    
    // 3. Generate a proof of passport
    try {


      // This code assumes RNFS.copyFileAssets is available and works as expected
      const assetFilename = 'circuit_final.zkey';
      const destinationPath = RNFS.DocumentDirectoryPath + '/' + assetFilename;

      try {
        await RNFS.copyFileAssets(assetFilename, destinationPath);
        console.log('File copied to: ' + destinationPath);
        // Now you can read from destinationPath as a regular file
      } catch (error) {
        console.error('Failed to copy file from assets', error);
      }

      // const a = await RNFS.readDirAssets("");
      // console.log('a', a)
      console.log('RNFS.DocumentDirectoryPath', RNFS.DocumentDirectoryPath)
      const start = Date.now();
      
      const zkey = await readAssetFileInChunks('circuit_final.zkey', 10 * 1024 * 1024); // 1MB chunk size
      // const zkey = await RNFS.readFileAssets('circuit_final.zkey', 'base64');
      console.log('zkey read')
      
      const wtns = await RNFS.readFileAssets('witness.wtns', 'base64');
      console.log('wtns read')
      
      const middle = Date.now();
      console.log('time to read files', middle - start)

      const {proof, pub_signals} = await rapidsnark.groth16_prover(zkey, wtns);
      console.log('proof', proof);
      console.log('pub_signals', pub_signals);

      const end = Date.now();
      console.log('time to generate proof', end - middle)
      console.log('total time', end - start)

      setGeneratingProof(false)
      setStep('proofGenerated');

      setTotalTime(end - start);
    } catch(err) {
      console.error(err);
      return
    }


    // NativeModules.RNPassportReader.provePassport(inputs, (err: any, res: any) => {
    //   const end = Date.now();
    //   setGeneratingProof(false)
    //   setStep('proofGenerated');

    //   if (err) {
    //     console.error(err);
    //     setError(
    //       "err: " + err.toString(),
    //     );
    //     return
    //   }
    //   console.log("res", res);
    //   const parsedResponse = JSON.parse(res);
    //   console.log('parsedResponse', parsedResponse);
    //   console.log('parsedResponse.duration', parsedResponse.duration);

    //   const deserializedProof = JSON.parse(parsedResponse.serialized_proof);
    //   console.log('deserializedProof', deserializedProof);
      
    //   const proofFormattedForSolidity = formatProof(deserializedProof);
    //   console.log('proofFormattedForSolidity', proofFormattedForSolidity);

    //   setProofTime(parsedResponse.duration);
    //   setTotalTime(end - start);

    //   setProofResult(JSON.stringify(proofFormattedForSolidity));

    //   // les outputs publics vont être postés on-chain comment ?
    // });
  };

  const handleMint = () => {
    setMinting(true)

    // 5. Format the proof and publicInputs as calldata for the verifier contract
    // 6. Call the verifier contract with the calldata

  };

  const proveRust = async () => {
    const start = Date.now();
    NativeModules.RNPassportReader.proveRust((err: any, res: any) => {
      const end = Date.now();
      if (err) {
        console.error(err);
        setProofResult(
          "res:" + err.toString() + ' time elapsed: ' + (end - start) + 'ms',
        );
      } else {
        console.log(res);
        setProofResult(
          "res:" + res.toString() + ' time elapsed: ' + (end - start) + 'ms',
        );
      }
    });
  };

  return (
    <GluestackUIProvider config={config}>
      <SafeAreaView style={backgroundStyle}>
        <StatusBar
          barStyle={isDarkMode ? 'light-content' : 'dark-content'}
          backgroundColor={backgroundStyle.backgroundColor}
        />
        <ScrollView
          contentInsetAdjustmentBehavior="automatic"
          style={{
            backgroundColor: isDarkMode ? Colors.black : Colors.white,
          }}
        >
          <View>
            {step === 'enterDetails' ? (
              <View style={styles.sectionContainer}>
                <Text style={styles.header}>Welcome to Proof of Passport</Text>
                <Text style={{textAlign: "center", fontSize: 20, marginTop: 20, marginBottom: 20}}>Enter Your Passport Details</Text>
                <Text>Passport Number</Text>
                <Input
                  variant="outline"
                  size="md"
                  marginBottom={10}
                  marginTop={4}
                >
                  <InputField
                    value={passportNumber}
                    onChangeText={setPassportNumber}
                    placeholder={DEFAULT_PNUMBER ?? 'Passport Number'}
                  />
                </Input>
                <Text>Date of Birth</Text>
                <Input
                  variant="outline"
                  size="md"
                  marginBottom={10}
                  marginTop={4}
                >
                  <InputField
                    value={dateOfBirth}
                    onChangeText={setDateOfBirth}
                    placeholder={DEFAULT_DOB ?? "YYMMDD"}
                  />
                </Input>
                <Text>Date of Expiry</Text>
                <Input
                  variant="outline"
                  size="md"
                  marginBottom={10}
                  marginTop={4}
                >
                  <InputField
                    value={dateOfExpiry}
                    onChangeText={setDateOfExpiry}
                    placeholder={DEFAULT_DOE ?? "YYMMDD"}
                  />
                </Input>

                <Button
                  onPress={scan}
                  marginTop={10}
                >
                  <ButtonText>Scan Passport with NFC</ButtonText>
                  {/* <ButtonIcon as={AddIcon} /> */}
                </Button>
              </View>
            ) : null}
            {step === 'scanning' ? (
              <View style={styles.sectionContainer}>
                <Text style={styles.header}>Put your phone on your passport</Text>
                <Spinner
                  size={60}
                  style={{marginTop: 70}}
                />
              </View>
            ) : null}
            {step === 'scanCompleted' ? (
              <View style={styles.sectionContainer}>
                <Text style={styles.header}>
                  Hi 
                </Text>
                <View
                  marginTop={20}
                  marginBottom={20}
                >
                  <Text
                    marginBottom={5}
                  >
                    Signature algorithm: 
                  </Text>
                  <Text
                    marginBottom={10}
                  >
                    What do you want to disclose ?
                  </Text>
                </View>
                <Text>Enter your address or ens</Text>
                <Input
                  variant="outline"
                  size="md"
                  marginBottom={10}
                  marginTop={4}
                >
                  <InputField
                    value={address}
                    onChangeText={setAddress}
                    placeholder="Your Address or ens name"
                  />
                </Input>

                {generatingProof ?
                  <Button
                    onPress={handleProve}
                  >
                    <ButtonSpinner mr="$1" />
                    <ButtonText>Generating zk proof</ButtonText>
                  </Button>
                  : <Button
                      onPress={handleProve}
                    >
                      <ButtonText>Generate zk proof</ButtonText>
                    </Button>
                }
              </View>
            ) : null}
            {step === 'proofGenerated' ? (
              <View style={styles.sectionContainer}>
                <Text style={styles.header}>Zero-knowledge proof generated</Text>

                <Text style={{fontWeight: "bold"}}>
                  Proof:
                </Text>
                <Text>
                  {proofResult}
                </Text>

                <Text>
                  <Text style={{ fontWeight: 'bold' }}>Proof Duration:</Text> {formatDuration(proofTime)}
                </Text>     
                <Text>
                  <Text style={{ fontWeight: 'bold' }}>Total Duration:</Text> {formatDuration(totalTime)}
                </Text>


                {generatingProof ?
                  <Button
                    onPress={handleMint}
                    marginTop={10}
                  >
                    <ButtonSpinner mr="$1" />
                    <ButtonText>Minting Proof of Passport</ButtonText>
                  </Button>
                  : <Button
                      onPress={handleMint}
                      marginTop={10}
                    >
                      <ButtonText>Mint Proof of Passport</ButtonText>
                    </Button>
                }
              </View>
            ) : null}
          </View>
          <View style={{...styles.sectionContainer, ...styles.testSection, marginTop: 80}}>
            <Text style={{...styles.sectionDescription, textAlign: "center"}}>Test functions</Text>

            <Button
              onPress={async () => {
                NativeModules.RNPassportReader.callRustLib((err: any, res: any) => {
                  if (err) {
                    console.error(err);
                    setTestResult(err);
                  } else {
                    console.log(res); // Should log "5"
                    setTestResult(res);
                  }
                });
              }}
              marginTop={10}
            >
              <ButtonText>Call arkworks lib</ButtonText>
            </Button>
            {testResult && <Text>{testResult}</Text>}

            <Button
              onPress={proveRust}
              marginTop={10}
            >
              <ButtonText>Generate sample proof with arkworks</ButtonText>
            </Button>
            {proofResult && <Text>{proofResult}</Text>}
            {error && <Text>{error}</Text>}

          </View>
        </ScrollView>
      </SafeAreaView>
    </GluestackUIProvider>
  );
}

const styles = StyleSheet.create({
  sectionContainer: {
    marginTop: 32,
    paddingHorizontal: 24,
  },
  sectionTitle: {
    fontSize: 24,
    fontWeight: '600',
  },
  sectionDescription: {
    marginTop: 8,
    fontSize: 18,
    fontWeight: '400',
  },
  highlight: {
    fontWeight: '700',
  },
  header: {
    fontSize: 22,
    fontWeight: 'bold',
    textAlign: 'center',
    marginTop: 20,
  },
  testSection: {
    backgroundColor: '#f2f2f2', // different background color
    padding: 10,
    borderTopWidth: 1,
    borderTopColor: '#dcdcdc', // adding a border top with a light color
    marginTop: 15,
  },
});

export default App;
