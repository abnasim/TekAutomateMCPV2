# TekAutomate SCPI Hard Knowledge — MSO 4/5/6 Series
# Source: 4/5/6 Series MSO Programmer Manual Rev A + DPO Group Mapping
# Pre-verified. No tool call needed for any command listed here.

---

## IEEE 488.2 (all instruments)
*IDN?
*RST
*CLS
*OPC?
*WAI
*ESR?
*ESE <NR1>
*SRE <NR1>
*STB?

---

## Acquisition
ACQuire:STATE {ON|OFF|RUN|STOP|1|0}
ACQuire:STOPAfter {RUNSTop|SEQuence}
ACQuire:MODe {SAMple|PEAKdetect|HIRes|AVErage|ENVelope}
ACQuire:NUMAVg <NR1>
ACQuire:NUMACq?
ACQuire:SEQuence:NUMSEQuence <NR1>
ACQuire:SEQuence:MODe {NUMACQs|NUMMEASurements}
ACQuire:SEQuence:CURrent?
ACQuire:FASTAcq:STATE {ON|OFF}
ACQuire:FASTAcq:PALEtte {NORMal|INVErted|TEMPerature|SPECtral}
ACQuire:FASTAVerage:STATE {ON|OFF}
ACQuire:FASTAVerage:LIMit <NR1>
ACQuire:MAXSamplerate?
ACQuire:NUMFRAMESACQuired?

---

## Vertical (Channel)
CH<x>:SCAle <NR2>
CH<x>:OFFSet <NR2>
CH<x>:POSition <NR2>
CH<x>:COUPling {AC|DC|DCREJect|GND}
CH<x>:TERmination {50|1.0E+6}
CH<x>:BANdwidth {FULL|<NR2>}
CH<x>:DESKew <NR2>
CH<x>:THRESHold <NR2>
CH<x>:LABel:NAMe <QString>
CH<x>:PRObe:GAIN?
CH<x>:PRObe:RESistance?
DISplay:GLObal:CH<x>:STATE {ON|OFF}
DISplay:WAVEView1:CH<x>:STATE {ON|OFF}
DISplay:WAVEView1:CH<x>:VERTical:SCAle <NR2>
DISplay:WAVEView1:CH<x>:VERTical:POSition <NR2>
# Spectrum View
CH<x>:SV:STATE {ON|OFF}
CH<x>:SV:CENTERFrequency <NR2>
CH<x>:SV:STARTFrequency?
CH<x>:SV:STOPFrequency?
SV:WINDOW {KAISERBESSel|FLATtop|HANning|HAMMing|BLACKHarris|RECTangular}
SV:RBWMode {AUTO|MANual}
SV:SPANRBWRatio <NR2>
SV:MARKER:PEAK:STATE {ON|OFF}
SV:MARKER:PEAK:THReshold <NR2>
SV:MARKER:PEAKS:FREQuency?
SV:MARKER:PEAKS:AMPLITUDE?
SV:CH<x>:UNIts {DBM|DBMV|DBUV|V|W}
SV:LOCKCenter {ON|OFF}

---

## Horizontal
HORizontal:SCAle <NR2>
HORizontal:RECOrdlength <NR1>
HORizontal:POSition <NR2>
HORizontal:SAMPLERate?
HORizontal:ACQDURATION?
HORizontal:DIVisions?
HORizontal:MODe {AUTO|MANual}
HORizontal:MODe:RECOrdlength <NR1>
HORizontal:MODe:SAMPLERate <NR2>
HORizontal:MODe:SCAle <NR2>
HORizontal:DELay:MODe {ON|OFF}
HORizontal:DELay:TIMe <NR2>
HORizontal:ROLL?
# FastFrame
HORizontal:FASTframe:STATE {ON|OFF}
HORizontal:FASTframe:COUNt <NR1>
HORizontal:FASTframe:MAXFRames?
HORizontal:FASTframe:REF:FRAme <NR1>
HORizontal:FASTframe:REF:INCLUde {ON|OFF}
HORizontal:FASTframe:MULtipleframes:MODe {ALL|MEAS|SAVE}
HORizontal:FASTframe:SUMFrame:STATE {ON|OFF}
HORizontal:FASTframe:TIMEStamp:REFerence?
HORizontal:FASTframe:TIMEStamp:SELECTED?
HORizontal:FASTframe:TIMEStamp:DELTa?
HORizontal:FASTframe:TIMEStamp:ALL?
HORizontal:FASTframe:XZEro:ALL?
HORizontal:FASTframe:XZEro:SELECTED?
# History
HORizontal:HISTory:STATe {ON|OFF}
HORizontal:HISTory:REF:ACQ <NR1>
HORizontal:HISTory:SELected <NR1>

---

## Trigger
TRIGger:A:TYPE {EDGE|WIDth|TIMEOut|RUNT|TRANsition|SETHold|LOGic|BUS|VIDeo}
TRIGger:A:EDGE:SOUrce {CH<x>|AUXIn|LINE}
TRIGger:A:EDGE:SLOpe {RIS|FALL|EITHer}
TRIGger:A:EDGE:COUPling {DC|HFRej|LFRej|NOISErej|AC}
TRIGger:A:LEVel:CH<x> <NR2>
TRIGger:A:MODe {AUTO|NORMal}
TRIGger:A:HOLDoff:TIMe <NR2>
TRIGger:A:HOLDoff:BY {TIMe|RANdom|DEFault}
TRIGger:A:PULSEWidth:WHEn {LESSthan|MOREthan|EQual|UNEQual|WITHin|OUTside}
TRIGger:A:PULSEWidth:WIDth <NR2>
TRIGger:A:PULSEWidth:HIGHLimit <NR2>
TRIGger:A:PULSEWidth:LOWLimit <NR2>
TRIGger:A:PULSEWidth:POLarity {POSitive|NEGative}
TRIGger:A:TIMEOut:TIMe <NR2>
TRIGger:A:TIMEOut:POLarity {STAYSHigh|STAYSLow|EITHer}
TRIGger:A:RUNT:WHEn {LESSthan|MOREthan|EQual|UNEQual|WITHin|OUTside}
TRIGger:A:RUNT:POLarity {POSitive|NEGative|EITHer}
TRIGger:A:TRANsition:WHEn {FASTerthan|SLOWerthan|EQual|UNEQual}
TRIGger:A:TRANsition:DELTatime <NR2>
TRIGger:A:TRANsition:POLarity {POSitive|NEGative|EITHer}
TRIGger:A:SETHold:CLOCk:SOUrce {CH<x>|AUXIn}
TRIGger:A:SETHold:CLOCk:EDGE {RIS|FALL}
TRIGger:A:SETHold:SETTime <NR2>
TRIGger:A:SETHold:HOLDTime <NR2>
TRIGger:A:LOGic:INPut:CH<x> {HIGH|LOW|X}
TRIGger:A:LOGic:WHEn {TRUe|FALSe|LESSthan|MOREthan|EQual|UNEQual}
TRIGger:A:LOGic:DELTatime <NR2>
TRIGger:B:STATE {ON|OFF}
TRIGger:B:EDGE:SOUrce {CH<x>|AUXIn}
TRIGger:B:EDGE:SLOpe {RIS|FALL|EITHer}
TRIGger:B:LEVel:CH<x> <NR2>
TRIGger:B:EVENts:COUNt <NR1>

---

## Measurement — MSO4/5/6 Modern (ADDMEAS pattern)
# Use for MSO4/5/6/7. NOT for DPO5k/7k.
MEASUrement:ADDMEAS {FREQUENCY|AMPLITUDE|RISETIME|FALLTIME|PERIOD|PK2PK|MEAN|RMS|HIGH|LOW|MAXIMUM|MINIMUM|POVERSHOOT|NOVERSHOOT|PDUTY|NDUTY|PWIDTH|NWIDTH|DELAY|PHASE|BURST|DATARATE|EYEHEIGHT|EYEWIDTH|EYEBASE|EYETOP|EYEOPEN|SNR|ENOBits}
MEASUrement:ADDNew <QString>
MEASUrement:MEAS<x>:SOUrce1 {CH<x>|MATH<x>|REF<x>}
MEASUrement:MEAS<x>:SOUrce2 {CH<x>|MATH<x>|REF<x>}
MEASUrement:MEAS<x>:STATE {ON|OFF}
MEASUrement:MEAS<x>:TYPE?
MEASUrement:MEAS<x>:GLOBalref {ON|OFF}
MEASUrement:MEAS<x>:RESUlts:CURRentacq:MEAN?
MEASUrement:MEAS<x>:RESUlts:CURRentacq:MAX?
MEASUrement:MEAS<x>:RESUlts:CURRentacq:MIN?
MEASUrement:MEAS<x>:RESUlts:CURRentacq:PK2PK?
MEASUrement:MEAS<x>:RESUlts:CURRentacq:STDDev?
MEASUrement:MEAS<x>:RESUlts:CURRentacq:POPUlation?
MEASUrement:MEAS<x>:RESUlts:ALLAcqs:MEAN?
MEASUrement:MEAS<x>:RESUlts:ALLAcqs:MAX?
MEASUrement:MEAS<x>:RESUlts:ALLAcqs:MIN?
MEASUrement:MEAS<x>:RESUlts:ALLAcqs:STDDev?
MEASUrement:MEAS<x>:RESUlts:ALLAcqs:POPUlation?
MEASUrement:MEAS<x>:ANNOTate {ON|OFF}
MEASUrement:DELete <QString>
MEASUrement:DELETEALL
MEASUrement:LIST?
MEASUrement:GATing {NONE|SCREen|CURSor|LOGic|SEARch|TIMe}
MEASUrement:GATing:STARTtime <NR2>
MEASUrement:GATing:ENDtime <NR2>
MEASUrement:AUTOset EXECute
MEASUrement:ANNOTate {ON|OFF}
MEASUrement:CH<x>:REFLevels:METHod {PERCent|ABSolute}
MEASUrement:CH<x>:REFLevels:PERCent:RISEHigh <NR2>
MEASUrement:CH<x>:REFLevels:PERCent:RISEMid <NR2>
MEASUrement:CH<x>:REFLevels:PERCent:RISELow <NR2>
MEASUrement:REFLevels:TYPE {GLOBal|PERSource}

---

## Measurement — Legacy DPO IMMed pattern
# Use for DPO5000/7000/70000 ONLY
MEASUrement:IMMed:TYPE {FREQuency|AMPlitude|RISe|FALL|PERiod|PK2Pk|MEAN|RMS|HIGH|LOW|MAX|MIN|POVershoot|NOVershoot|PWIdth|NWIdth|PDUty|NDUty|BURst|DELAY|PHASE}
MEASUrement:IMMed:SOUrce<x> {CH<x>|MATH<x>|REF<x>}
MEASUrement:IMMed:VALue?
MEASUrement:IMMed:UNIts?
MEASUrement:MEAS<x>:TYPE {FREQuency|AMPlitude|RISe|FALL|PERiod|PK2Pk|MEAN|RMS}
MEASUrement:MEAS<x>:SOUrce<x> {CH<x>}
MEASUrement:MEAS<x>:VALue?
MEASUrement:MEAS<x>:MEAN?
MEASUrement:MEAS<x>:MAXimum?
MEASUrement:MEAS<x>:MINimum?
MEASUrement:MEAS<x>:UNIts?
MEASUrement:MEAS<x>:STATE {ON|OFF}

---

## Bus
BUS:ADDNew {CAN|I2C|SPI|UART|LIN|FLEXRAY|AUDIO|ARINC429A|MIL1553B|USB|ETHERnet|PCIE|I3C|SENT|SPMI|CPHY}
BUS:DELete <QString>
BUS:LIST?
BUS:B<x>:DISplay:DECOde:STAte {ON|OFF}
BUS:B<x>:LABel <QString>
BUS:B<x>:STATE {ON|OFF}
DISplay:GLObal:B<x>:STATE {ON|OFF}
# CAN / CAN FD
BUS:B<x>:CAN:BITRate {RATE10K|RATE20K|RATE50K|RATE100K|RATE125K|RATE250K|RATE500K|RATE800K|RATE1M|CUSTom}
BUS:B<x>:CAN:BITRate:CUSTom <NR1>
BUS:B<x>:CAN:SOUrce {CH<x>|MATH<x>}
BUS:B<x>:CAN:SIGNal {CANH|CANL|DIFF|RX|TX}
BUS:B<x>:CAN:THReshold <NR2>
BUS:B<x>:CAN:SAMPLEpoint <NR2>
BUS:B<x>:CAN:STANDard {CAN2X|FDISO|FDNONISO|XL}
BUS:B<x>:CAN:FD:BITRate {RATE1M|RATE2M|RATE4M|RATE5M|RATE8M|RATE10M|CUSTom}
BUS:B<x>:CAN:FD:BITRate:CUSTom <NR1>
# I2C
BUS:B<x>:I2C:CLOCk:SOUrce {CH<x>}
BUS:B<x>:I2C:CLOCk:THReshold <NR2>
BUS:B<x>:I2C:DATa:SOUrce {CH<x>}
BUS:B<x>:I2C:DATa:THReshold <NR2>
# SPI
BUS:B<x>:SPI:CLOCk:SOUrce {CH<x>}
BUS:B<x>:SPI:CLOCk:POLarity {RIS|FALL}
BUS:B<x>:SPI:DATa:SOUrce {CH<x>}
BUS:B<x>:SPI:DATa:SIZe <NR1>
BUS:B<x>:SPI:SELect:SOUrce {CH<x>}
BUS:B<x>:SPI:SELect:POLarity {LOW|HIGH}
BUS:B<x>:SPI:BITOrder {MSB|LSB}
BUS:B<x>:SPI:FRAMING {SSACTive|IDLEtime}
# UART / RS232C
BUS:B<x>:RS232C:SOUrce {CH<x>}
BUS:B<x>:RS232C:BITRate <NR1>
BUS:B<x>:RS232C:DATABits {7|8}
BUS:B<x>:RS232C:POLarity {NORmal|INVERted}
BUS:B<x>:RS232C:PARity {NONe|ODD|EVEN}
# LIN
BUS:B<x>:LIN:SOUrce {CH<x>}
BUS:B<x>:LIN:BITRate:CUSTom <NR1>
BUS:B<x>:LIN:STANDard {V1X|V2X|MIXed}
BUS:B<x>:LIN:POLarity {NORmal|INVERted}
# FLEXRAY
BUS:B<x>:FLEXray:SOUrce {CH<x>}
BUS:B<x>:FLEXray:BITRate:CUSTom <NR1>
# USB
BUS:B<x>:USB:SOUrce {CH<x>}
BUS:B<x>:USB:BITRate {LOW|FULL|HIGH}
# AutoEthernet
BUS:B<x>:AUTOETHERnet:SOUrce {CH<x>}
BUS:B<x>:AUTOETHERnet:TYPe {ENET10|ENET100|ENET1000|T1S}
BUS:B<x>:AUTOETHERnet:THRESHold <NR2>
# ARINC429A
BUS:B<x>:ARINC429A:SOUrce {CH<x>}
BUS:B<x>:ARINC429A:BITRate {LOW|HIGH|CUSTom}
BUS:B<x>:ARINC429A:BITRate:CUSTom <NR1>
BUS:B<x>:ARINC429A:POLarity {NORmal|INVERted}
# MIL-STD-1553B
BUS:B<x>:MIL1553B:SOUrce {CH<x>}
BUS:B<x>:MIL1553B:POLarity {NORmal|INVERted}

---

## Save and Recall
SAVe:IMAGe <QString>
SAVe:IMAGe:COMPosition {NORMal|INVErted}
SAVe:IMAGe:VIEWTYpe {FULLscreen|GRATiculeonly}
SAVe:WAVEform {CH<x>|MATH<x>|REF<x>}, <QString>
SAVe:WAVEform:GATing {NONE|SCREen|CURSor}
SAVe:SETUp <QString>
SAVe:SETUp:INCLUDEREFs {ON|OFF}
SAVe:SESsion <QString>
SAVe:EVENTtable:BUS <QString>
SAVe:EVENTtable:MEASUrement <QString>
SAVe:PLOTData <QString>
RECAll:SETUp <QString>
RECAll:WAVEform <QString>, {REF<x>}
RECAll:SESsion <QString>
REF:ADDNew <QString>
REF:LIST?
DISplay:GLObal:REF<x>:STATE {ON|OFF}
FILESystem:CWD <QString>
FILESystem:CWD?
FILESystem:DIR?
FILESystem:DELEte <QString>
FILESystem:COPy <QString>, <QString>
FILESystem:MKDir <QString>
FILESystem:READFile <QString>
FILESystem:WRITEFile <QString>

---

## Waveform Transfer
DATa:SOUrce {CH<x>|MATH<x>|REF<x>}
DATa:SOUrce:AVAILable?
DATa:ENCdg {ASCIi|RIBinary|RPBinary|SRIbinary|SRPbinary|FPbinary|SFPbinary}
DATa:STARt <NR1>
DATa:STOP <NR1>
WFMOutpre:BYT_Nr {1|2|4|8}
WFMOutpre:BYT_Or {LSB|MSB}
WFMOutpre:BN_Fmt {RI|RP|FP}
WFMOutpre:ENCdg {ASCIi|BINary}
WFMOutpre:XINcr?
WFMOutpre:XUNit?
WFMOutpre:XZEro?
WFMOutpre:YMUlt?
WFMOutpre:YOFf?
WFMOutpre:YUNit?
WFMOutpre:YZEro?
WFMOutpre:NR_Pt?
WFMOutpre:WFId?
WFMOutpre:PT_Fmt {Y|ENV}
CURVe?

---

## Math
MATH:MATH<x>:TYPe {BASic|FFT|ADVanced|FILTER|SPECtrum}
MATH:MATH<x>:DEFine <QString>
MATH:MATH<x>:SOUrce<x> {CH<x>|REF<x>}
MATH:MATH<x>:SPECTral:WINdow {HAMMing|HANning|BLACKHarris|KAISERBESSel|RECTangular|FLATtop}
MATH:MATH<x>:SPECTral:MAG {LINEar|LOG}
MATH:MATH<x>:SPECTral:REFLevel <NR2>
MATH:MATH<x>:SPECTral:SUPPress <NR2>
MATH:MATH<x>:SPECTral:TYPE {MAGnitude|PHASe|REAL|IMAGinary}
MATH:MATH<x>:FILTer:MODe {ON|OFF}
MATH:MATH<x>:FILTer:RISetime <NR2>
MATH:MATH<x>:NUMAVg <NR1>
MATH:MATH<x>:VUNIT <QString>
MATH:MATH<x>:THRESHold <NR2>
DISplay:GLObal:MATH<x>:STATE {ON|OFF}

---

## Display
DISplay:WAVEView1:STYle {DOTs|INTENSIFied|VECTors}
DISplay:WAVEView1:GRAticule {FULl|NONe|GRId|SOLid|FRAme}
DISplay:WAVEView1:INTENSITy:WAVEform <NR1>
DISplay:WAVEView1:INTENSITy:GRATicule <NR1>
DISplay:WAVEView1:VIEWStyle {OVErlay|STAcked}
DISplay:WAVEView1:FILTer {ON|OFF}
DISplay:WAVEView1:ZOOM:ZOOM1:STATe {ON|OFF}
DISplay:WAVEView1:ZOOM:ZOOM1:HORizontal:SCALe <NR2>
DISplay:WAVEView1:ZOOM:ZOOM1:HORizontal:POSition <NR2>
DISplay:WAVEView1:ZOOM:ZOOM1:VERTical:SCALe <NR2>
DISplay:WAVEView1:ZOOM:ZOOM1:VERTical:POSition <NR2>

---

## Cursor
CURSor:FUNCtion {OFF|VBArs|HBArs|WAVEform|SCREEN|XY}
CURSor:STATE {ON|OFF}
CURSor:MODe {INDependent|TRACk}
CURSor:HBArs:DELTa?
CURSor:VBArs:DELTa?
DISplay:WAVEView1:CURSor:CURSOR:STATE {ON|OFF}
DISplay:WAVEView1:CURSor:CURSOR:ASOUrce {CH<x>|MATH<x>|REF<x>}
DISplay:WAVEView1:CURSor:CURSOR:BSOUrce {CH<x>|MATH<x>|REF<x>}
DISplay:WAVEView1:CURSor:CURSOR:VBArs:APOSition <NR2>
DISplay:WAVEView1:CURSor:CURSOR:VBArs:BPOSition <NR2>
DISplay:WAVEView1:CURSor:CURSOR:HBArs:APOSition <NR2>
DISplay:WAVEView1:CURSor:CURSOR:HBArs:BPOSition <NR2>
DISplay:WAVEView1:CURSor:CURSOR:VBArs:DELTa?
DISplay:WAVEView1:CURSor:CURSOR:HBArs:DELTa?
DISplay:WAVEView1:CURSor:CURSOR:FUNCtion {OFF|VBArs|HBArs|WAVEform|SCREEN}

---

## Search and Mark
SEARCH:ADDNew <QString>
SEARCH:DELete <QString>
SEARCH:DELETEALL
SEARCH:LIST?
SEARCH:SEARCH<x>:STATE {ON|OFF}
SEARCH:SEARCH<x>:TRIGger:A:TYPE {EDGE|WIDth|TIMEOut|RUNT|TRANsition|SETHold|LOGic|BUS}
SEARCH:SEARCH<x>:TRIGger:A:EDGE:SOUrce {CH<x>}
SEARCH:SEARCH<x>:TRIGger:A:EDGE:SLOpe {RIS|FALL|EITHer}
SEARCH:SEARCH<x>:TRIGger:A:LEVel:CH<x> <NR2>
SEARCH:SEARCH<x>:NAVigate {NEXT|PREV}
SEARCH:SEARCH<x>:TOTAL?
MARK:CREATE {SEARCH|CH<x>|TRIGger}
MARK:DELEte {ALL|SEARCH|CH<x>}
MARK:SELECTED:STARt?
MARK:SELECTED:END?

---

## Histogram
HISTogram:ADDNew <QString>
HISTogram:HISTogram<x>:STATE {ON|OFF}
HISTogram:HISTogram<x>:SOUrce {CH<x>|MATH<x>}
HISTogram:HISTogram<x>:SIZe <NR1>
HISTogram:HISTogram<x>:MEASurement:MEAN?
HISTogram:HISTogram<x>:MEASurement:STDDev?
HISTogram:HISTogram<x>:MEASurement:PK2PK?
HISTogram:HISTogram<x>:MEASurement:MAX?
HISTogram:HISTogram<x>:MEASurement:MIN?
HISTogram:HISTogram<x>:MEASurement:RESUlts?
HISTogram:LIST?

---

## AFG (requires option AFG)
AFG:FUNCtion {SINusoid|SQUare|PULse|RAMP|DC|NOISe|ARBitrary}
AFG:FREQuency <NR2>
AFG:AMPLitude <NR2>
AFG:OFFSet <NR2>
AFG:HIGHLevel <NR2>
AFG:LOWLevel <NR2>
AFG:PERIod <NR2>
AFG:SQUare:DUty <NR2>
AFG:PULse:WIDth <NR2>
AFG:RAMP:SYMmetry <NR2>
AFG:OUTPut:STATE {ON|OFF}
AFG:OUTPut:MODe {CONTinuous|BURSt}
AFG:OUTPut:LOAd:IMPEDance {50|HIGHZ}
AFG:NOISEAdd:STATE {ON|OFF}
AFG:NOISEAdd:PERCent <NR2>
AFG:BURSt:CCOUnt <NR1>
AFG:BURSt:TRIGger

---

## DVM (option)
DVM:DISPLAYMODE {ACRMS|ACDCRMS|DC|FREQ|OFF}
DVM:SOUrce {CH<x>}
DVM:MEASurement:ACRMS?
DVM:MEASurement:ACDCRMS?
DVM:MEASurement:DC?
DVM:MEASurement:FREQ?

---

## Power Analysis (option)
POWer:ADDNew <QString>
POWer:DELete <QString>
POWer:POWer<x>:TYPe {SWITCHINGloss|MAGNETIC|SOA|HARMONICS|RIPPLE|EFFiciency|TURNON|TURNOFF|CYCLeamp|DIDT|DVDT|FREQUENCY}
POWer:POWer<x>:AUTOSet EXECute
POWer:POWer<x>:GATing {NONE|SCREen|CURSor}
POWer:POWer<x>:FREQUENCY:INPUTSOurce {CH<x>}
POWer:POWer<x>:HARMONICS:VSOURce {CH<x>}
POWer:POWer<x>:HARMONICS:ISOURce {CH<x>}
POWer:POWer<x>:HARMONICS:STANdard {IEC|MIL|GENERIC}
POWer:POWer<x>:EFFICIENCY:VSOUrce {CH<x>}
POWer:POWer<x>:EFFICIENCY:ISOUrce {CH<x>}

---

## Act on Event
ACTONEVent:ENable {ON|OFF}
ACTONEVent:TRIGger:ACTION:SAVEIMAGe:STATE {ON|OFF}
ACTONEVent:TRIGger:ACTION:SAVEWAVEform:STATE {ON|OFF}
ACTONEVent:TRIGger:ACTION:STOPACQ:STATE {ON|OFF}
ACTONEVent:SEARCH:ACTION:SAVEIMAGe:STATE {ON|OFF}
ACTONEVent:SEARCH:ACTION:SAVEWAVEform:STATE {ON|OFF}
ACTONEVent:MEASUrement:ACTION:SAVEIMAGe:STATE {ON|OFF}
ACTONEVent:LIMITCount <NR1>
SAVEONEVent:FILEDest <QString>
SAVEONEVent:FILEName <QString>
SAVEONEVent:IMAGe:FILEFormat {PNG|BMP|JPEG}
SAVEONEVent:WAVEform:SOUrce {CH<x>|MATH<x>|ALL}

---

## Miscellaneous
HEADer {ON|OFF}
VERBose {ON|OFF}
LOCk {ALL|NONE}
UNLock ALL
FACToryreset EXECute
SYSTem:ERRor:CODE:ALL?
SYSTem:ERRor:COUNt?
ALLEV?
EVMsg?
EVQty?

---

## Backwards Compatibility — Legacy→Modern (MSO4/5/6 accepts both)
# Always use modern form in generated flows
# CH1:VOLTS                    → CH1:SCAle
# HORizontal:MODe:SCAle        → HORizontal:SCAle
# HORizontal:MODe:RECOrdlength → HORizontal:RECOrdlength
# FASTAcq:STATE                → ACQuire:FASTAcq:STATE
# BUS:B<n>:CAN:BITRate:VALue   → BUS:B<n>:CAN:BITRate:CUSTom
# BUS:B<n>:CAN:FD:BITRate:VALue→ BUS:B<n>:CAN:FD:BITRate:CUSTom
# BUS:B<n>:I2C:SCLk:SOUrce     → BUS:B<n>:I2C:CLOCk:SOUrce
# BUS:B<n>:SPI:SCLk:SOUrce     → BUS:B<n>:SPI:CLOCk:SOUrce
# BUS:B<n>:SPI:MOSi:INPut      → BUS:B<n>:SPI:DATa:SOUrce
# BUS:B<n>:SPI:SS:SOUrce       → BUS:B<n>:SPI:SELect:SOUrce
# BUS:B<n>:RS232C:TX:SOUrce    → BUS:B<n>:RS232C:SOUrce
# DPOJET:GATing                → MEASUrement:MEAS<n>:GATing
# MEASUrement:MEAS<n>:FUNDAMENTALFreq → MEASUrement:MEAS<n>:FREQ
# CURSor:VBArs:POSITIONB       → DISplay:WAVEView1:CURSor:CURSOR:VBArs:BPOSition
# MATH:MATH<n>:POSITION        → DISplay:WAVEView1:MATH:MATH<n>:VERTical:POSition
# BUS:B<n>:STATE               → DISplay:GLObal:B<n>:STATE

---

## SCPI Notation
<NR1> = integer         e.g. 50
<NR2> = decimal         e.g. 1.0, 1e-6
<NR3> = scientific      e.g. 1.5E-6
<QString> = quoted      e.g. "C:/path/file.png"
{A|B} = choose one
[x] = optional
CH<x>       = CH1,CH2,CH3,CH4
B<x>        = B1..B16
MEAS<x>     = MEAS1,MEAS2...
MATH<x>     = MATH1,MATH2...
REF<x>      = REF1..REF4
SEARCH<x>   = SEARCH1,SEARCH2...
WAVEView<x> = WAVEView1 only
PLOTView<x> = PLOTView1 only
ZOOM<x>     = ZOOM1 only
NaN         = 9.91E+37 (query error)
